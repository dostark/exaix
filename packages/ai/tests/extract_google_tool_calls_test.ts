/**
 * @module ExtractGoogleToolCallsTest
 * @path packages/ai/tests/extract_google_tool_calls_test.ts
 * @description Phase 153 Step 3 — tests for `extractGoogleToolCalls()`: parses well-formed
 * `candidates[0].content.parts[].functionCall` entries into `IProviderToolCall[]` with `input`
 * as the ALREADY-PARSED `args` object (no JSON.parse needed, unlike OpenAI's string
 * `arguments`), generates a unique synthetic `id` per call (Gemini's `functionCall` has no
 * `id` field), and returns undefined when no functionCall parts exist.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/ai/src/provider_common_utils.ts",
 *   "packages/ai/tests/providers/extract_anthropic_tool_calls_multiple_test.ts"
 * ]
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { extractGoogleToolCalls, type GoogleResponse } from "../src/provider_common_utils.ts";

Deno.test("extractGoogleToolCalls parses a well-formed functionCall part into IProviderToolCall with the already-object args", () => {
  const response: GoogleResponse = {
    candidates: [{
      content: {
        parts: [{ functionCall: { name: "write_file", args: { path: "a.ts", content: "hello" } } }],
      },
    }],
  };
  const result = extractGoogleToolCalls(response);
  assertEquals(result!.length, 1);
  assertEquals(result![0].name, "write_file");
  assertEquals(result![0].input, { path: "a.ts", content: "hello" });
});

Deno.test("extractGoogleToolCalls generates a non-empty id since Gemini's functionCall has none", () => {
  const response: GoogleResponse = {
    candidates: [{ content: { parts: [{ functionCall: { name: "read_file", args: {} } }] } }],
  };
  const result = extractGoogleToolCalls(response);
  assertEquals(typeof result![0].id, "string");
  assertNotEquals(result![0].id, "");
});

Deno.test("extractGoogleToolCalls generates unique ids across multiple functionCall parts in one response", () => {
  const response: GoogleResponse = {
    candidates: [{
      content: {
        parts: [
          { functionCall: { name: "write_file", args: { path: "a.ts" } } },
          { functionCall: { name: "patch_file", args: { path: "b.ts" } } },
        ],
      },
    }],
  };
  const result = extractGoogleToolCalls(response);
  assertEquals(result!.length, 2);
  assertNotEquals(result![0].id, result![1].id);
  assertEquals(result![0].name, "write_file");
  assertEquals(result![1].name, "patch_file");
});

Deno.test("extractGoogleToolCalls skips text-only parts and only extracts functionCall parts", () => {
  const response: GoogleResponse = {
    candidates: [{
      content: {
        parts: [
          { text: "I'll make those changes." },
          { functionCall: { name: "patch_file", args: { path: "c.ts" } } },
        ],
      },
    }],
  };
  const result = extractGoogleToolCalls(response);
  assertEquals(result!.length, 1);
  assertEquals(result![0].name, "patch_file");
});

Deno.test("extractGoogleToolCalls returns undefined when no functionCall parts exist", () => {
  const response: GoogleResponse = {
    candidates: [{ content: { parts: [{ text: "Done." }] } }],
  };
  assertEquals(extractGoogleToolCalls(response), undefined);
});

Deno.test("extractGoogleToolCalls returns undefined for empty/missing candidates", () => {
  assertEquals(extractGoogleToolCalls({}), undefined);
  assertEquals(extractGoogleToolCalls({ candidates: [] }), undefined);
  assertEquals(extractGoogleToolCalls({ candidates: [{ content: { parts: [] } }] }), undefined);
});

Deno.test('extractGoogleToolCalls sets type to "function" on each entry', () => {
  const response: GoogleResponse = {
    candidates: [{ content: { parts: [{ functionCall: { name: "read_file", args: {} } }] } }],
  };
  const result = extractGoogleToolCalls(response);
  assertEquals(result![0].type, "function");
});

Deno.test("extractGoogleToolCalls carries thoughtSignature when the functionCall part provides it (GAP-153-E)", () => {
  const response: GoogleResponse = {
    candidates: [{
      content: { parts: [{ functionCall: { name: "patch_file", args: { path: "a.ts" }, thoughtSignature: "sig-x" } }] },
    }],
  };
  const result = extractGoogleToolCalls(response);
  assertEquals(result![0].thoughtSignature, "sig-x");
});

Deno.test("extractGoogleToolCalls leaves thoughtSignature undefined when the part omits it", () => {
  const response: GoogleResponse = {
    candidates: [{ content: { parts: [{ functionCall: { name: "read_file", args: {} } }] } }],
  };
  const result = extractGoogleToolCalls(response);
  assertEquals(result![0].thoughtSignature, undefined);
});
