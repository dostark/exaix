/**
 * @module GoogleTokenCostTest
 * @path packages/ai/tests/google_token_cost_test.ts
 * @description Gemini bills input and output at different rates, and thinking tokens at the output rate. The Google
 *   token mapper must price each part at its own rate, not the output rate for every token.
 * @architectural-layer AI
 * @related-files [packages/ai/src/provider_common_utils.ts, packages/core/src/types/constants.ts]
 */

import { assertEquals } from "@std/assert";
import { tokenMapperGoogle } from "../src/provider_common_utils.ts";
import type { GoogleResponse } from "../src/provider_common_utils.ts";

const MILLION = 1_000_000;
const PROVIDER_ID = "google-gemini-3.8-flash";
const INPUT_RATE_PER_MTOK = 0.75;
const OUTPUT_RATE_PER_MTOK = 3.75;

function costOf(usageMetadata: GoogleResponse["usageMetadata"]): number | undefined {
  return tokenMapperGoogle("gemini-3.8-flash")({ usageMetadata } as GoogleResponse, PROVIDER_ID)?.cost_usd;
}

Deno.test("prompt tokens are priced at the input rate", () => {
  const cost = costOf({ promptTokenCount: MILLION, candidatesTokenCount: 0, totalTokenCount: MILLION });
  assertEquals(Math.round((cost ?? 0) * MILLION) / MILLION, INPUT_RATE_PER_MTOK);
});

Deno.test("answer tokens are priced at the output rate", () => {
  const cost = costOf({ promptTokenCount: 0, candidatesTokenCount: MILLION, totalTokenCount: MILLION });
  assertEquals(Math.round((cost ?? 0) * MILLION) / MILLION, OUTPUT_RATE_PER_MTOK);
});

Deno.test("thinking tokens are priced at the output rate, not the input rate", () => {
  const cost = costOf({
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    thoughtsTokenCount: MILLION,
    totalTokenCount: MILLION,
  });
  assertEquals(Math.round((cost ?? 0) * MILLION) / MILLION, OUTPUT_RATE_PER_MTOK);
});
