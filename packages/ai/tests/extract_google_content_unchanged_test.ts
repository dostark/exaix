/**
 * @module ExtractGoogleContentUnchangedTest
 * @path packages/ai/tests/extract_google_content_unchanged_test.ts
 * @description Phase 153 Step 3 [regression] — `extractGoogleContent()`'s pre-existing
 * text-only extraction behavior is unchanged by this step's functionCall/toolCallExtractor
 * additions to the same file.
 * @architectural-layer Tests
 * @related-files ["packages/ai/src/provider_common_utils.ts"]
 */

import { assertEquals } from "@std/assert";
import { extractGoogleContent, type GoogleResponse } from "../src/provider_common_utils.ts";

Deno.test("[regression] extractGoogleContent still extracts candidates[0].content.parts[0].text unchanged", () => {
  const response: GoogleResponse = { candidates: [{ content: { parts: [{ text: "hello world" }] } }] };
  assertEquals(extractGoogleContent(response), "hello world");
});

Deno.test("[regression] extractGoogleContent still returns empty string when text is absent", () => {
  assertEquals(extractGoogleContent({}), "");
  assertEquals(extractGoogleContent({ candidates: [] }), "");
  assertEquals(extractGoogleContent({ candidates: [{ content: { parts: [] } }] }), "");
});

Deno.test("[regression] extractGoogleContent ignores functionCall parts and still returns the first text part", () => {
  const response: GoogleResponse = {
    candidates: [{
      content: { parts: [{ text: "I'll call a tool" }, { functionCall: { name: "write_file", args: {} } }] },
    }],
  };
  assertEquals(extractGoogleContent(response), "I'll call a tool");
});
