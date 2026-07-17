/**
 * @module JSONRepairTest
 * @path packages/core/tests/func/json_repair_test.ts
 * @description Verifies repairJSON extracts a JSON object regardless of surrounding prose or
 * markdown fences (extract_json_object runs first, isolating the braces span before any other
 * repair touches the content), and that the newlines_in_strings repair only escapes a newline
 * genuinely inside a string value — not the normal newlines between a well-formatted, multi-line
 * JSON object's keys.
 */

import { assertEquals } from "@std/assert";
import { repairJSON } from "../../src/func/json_repair.ts";

Deno.test("[JSONRepair] extracts a fenced JSON block with no surrounding prose (existing behavior)", () => {
  const input = '```json\n{"a": 1}\n```';
  const { repaired, appliedRepairs } = repairJSON(input);
  assertEquals(JSON.parse(repaired), { a: 1 });
  assertEquals(appliedRepairs.includes("extract_json_object"), true);
});

Deno.test("[JSONRepair] extracts a fenced JSON block preceded by prose (real Anthropic response shape)", () => {
  const input = 'I appreciate the context, but let me clarify.\n\n```json\n{"status": "ready", "message": "ok"}\n```';
  const { repaired } = repairJSON(input);
  assertEquals(JSON.parse(repaired), { status: "ready", message: "ok" });
});

Deno.test("[JSONRepair] extracts a fenced JSON block followed by trailing prose", () => {
  const input = '```json\n{"a": 1}\n```\n\nLet me know if you need anything else.';
  const { repaired } = repairJSON(input);
  assertEquals(JSON.parse(repaired), { a: 1 });
});

Deno.test("[JSONRepair] extracts a fenced JSON block with prose both before and after", () => {
  const input = 'Sure thing!\n```json\n{"a": 1, "b": [1,2,3]}\n```\nHope that helps.';
  const { repaired } = repairJSON(input);
  assertEquals(JSON.parse(repaired), { a: 1, b: [1, 2, 3] });
});

Deno.test("[JSONRepair] plain JSON with no fence is unaffected", () => {
  const input = '{"a": 1}';
  const { repaired, appliedRepairs } = repairJSON(input);
  assertEquals(JSON.parse(repaired), { a: 1 });
  assertEquals(appliedRepairs.includes("extract_json_object"), false);
});

Deno.test("[JSONRepair] well-formed multi-line, multi-key JSON is never corrupted by newlines_in_strings", () => {
  // Regression: newlines_in_strings' /"[^"]*\n[^"]*"/g pattern previously matched from one
  // value's closing quote, across the structural ",\n  " between two keys, to the NEXT key's
  // opening quote — treating "status": "analyzing",\n  "findings" as if the newline were inside
  // one string. This corrupts virtually any well-formed multi-line JSON object.
  // style-exclude:SMALL_FIXTURE_OK - fixture shape (multi-key, multi-line JSON) is the regression itself
  const input = `{
  "status": "analyzing",
  "findings": {
    "issues": [],
    "severity": "high"
  },
  "plan": {
    "step_1": "description one",
    "step_2": "description two"
  }
}`;
  const { repaired } = repairJSON(input);
  assertEquals(JSON.parse(repaired), {
    status: "analyzing",
    findings: { issues: [], severity: "high" },
    plan: { step_1: "description one", step_2: "description two" },
  });
});

Deno.test("[JSONRepair] a genuine literal newline inside one string value is still escaped", () => {
  const input = '{"message": "line one\nline two"}';
  const { repaired } = repairJSON(input);
  assertEquals(JSON.parse(repaired), { message: "line one\nline two" });
});

Deno.test("[JSONRepair] real Anthropic response shape: multi-paragraph prose with bash fences before the JSON fence", () => {
  // Regression: newlines_in_strings previously ran before the JSON object was isolated from
  // surrounding prose, and its /"[^"]*\n[^"]*"/g pattern matched ACROSS unrelated quoted JSON
  // key/value pairs separated by a real newline (not inside one string value) — inserting a
  // literal "\n" between them and corrupting otherwise-valid JSON into unparseable text.
  const input = `I need to clarify the issue with my previous response. The error indicated
markdown code blocks broke JSON validity.

\`\`\`bash
read_file src/utils.ts
\`\`\`

Once I receive the file contents, here is my response:

\`\`\`json
{
  "status": "analyzing",
  "findings": {
    "issues": [],
    "severity": "high"
  },
  "plan": {
    "step_1": "description one",
    "step_2": "description two"
  }
}
\`\`\`

Please let me know if you need anything else.`;

  const { repaired } = repairJSON(input);
  assertEquals(JSON.parse(repaired), {
    status: "analyzing",
    findings: { issues: [], severity: "high" },
    plan: { step_1: "description one", step_2: "description two" },
  });
});
