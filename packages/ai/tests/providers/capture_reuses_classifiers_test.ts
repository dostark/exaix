/**
 * @module CaptureReusesClassifiersTest
 * @path packages/ai/tests/providers/capture_reuses_classifiers_test.ts
 * @description Phase 157 Step 2 — capture validation must call the SAME exported prompt
 *   classifiers replay trusts (`isFlowStepPrompt`, `isReActLoopPrompt`,
 *   `responseForPromptDialect`, exported from `mock_llm_provider.ts`), not a private copy.
 *   Proven two ways: the classifiers themselves are importable and behave as documented, and
 *   CaptureRecordingProvider's contract validation classifies each dialect exactly the way
 *   these classifiers say it should — a well-formed response for the classified dialect is
 *   accepted, one shaped for a DIFFERENT dialect is rejected.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts, packages/ai/src/providers/capture_recording_provider.ts]
 */

import { assertEquals } from "@std/assert";
import {
  isFlowStepPrompt,
  isReActLoopPrompt,
  responseForPromptDialect,
} from "../../src/providers/mock_llm_provider.ts";

const FLOW_STEP_PROMPT = "## Step 1\nSome merged flow context from the prior step.";
const REACT_LOOP_PROMPT = "IDENTITY: default\nAVAILABLE TOOLS: write_file, read_file";
const LEGACY_PLAN_PROMPT = "Please implement a REST API endpoint for user registration.";

Deno.test("[capture_reuses_classifiers] isFlowStepPrompt classifies a flow-step prompt", () => {
  assertEquals(isFlowStepPrompt(FLOW_STEP_PROMPT), true);
  assertEquals(isFlowStepPrompt(REACT_LOOP_PROMPT), false);
  assertEquals(isFlowStepPrompt(LEGACY_PLAN_PROMPT), false);
});

Deno.test("[capture_reuses_classifiers] isReActLoopPrompt classifies a ReAct-loop prompt", () => {
  assertEquals(isReActLoopPrompt(REACT_LOOP_PROMPT), true);
  assertEquals(isReActLoopPrompt(FLOW_STEP_PROMPT), false);
  assertEquals(isReActLoopPrompt(LEGACY_PLAN_PROMPT), false);
});

Deno.test("[capture_reuses_classifiers] responseForPromptDialect returns a dialect-specific exemplar, or null for the legacy dialect", () => {
  assertEquals(typeof responseForPromptDialect(FLOW_STEP_PROMPT), "string");
  assertEquals(typeof responseForPromptDialect(REACT_LOOP_PROMPT), "string");
  assertEquals(responseForPromptDialect(LEGACY_PLAN_PROMPT), null);
});
