/**
 * @module FixtureMissTest
 * @path packages/ai/tests/providers/fixture_miss_test.ts
 * @description Phase 157 Step 1 — a call site with no matching recording is a miss. Under
 *   `strictRecordings` a miss is fatal and names the call site so the missing fixture can be
 *   captured; outside strict mode it falls back to pattern matching (or throws, when no
 *   patterns are configured), exactly like today's whole-prompt-hash miss handling.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/mock_llm_provider.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { MockStrategy } from "@exaix/core";
import type { ICallSite } from "../../src/types.ts";
import { MockLLMError, MockLLMProvider } from "../../src/providers/mock_llm_provider.ts";

Deno.test("[fixture_miss] a missing call site fails under strict mode, naming the call site", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
    patterns: [],
    strictRecordings: true,
  });
  const callSite: ICallSite = { scenarioId: "flow_blueprints", stepId: "missing-step", callIndex: 0 };

  await assertRejects(
    async () => await provider.generate("some prompt", { callSite }),
    MockLLMError,
    "flow_blueprints/missing-step#0",
  );
});

Deno.test("[fixture_miss] a missing call site falls back to pattern matching outside strict mode", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
    patterns: [{ pattern: /.*/, response: "pattern fallback" }],
  });
  const callSite: ICallSite = { scenarioId: "flow_blueprints", stepId: "missing-step", callIndex: 0 };

  const result = await provider.generate("some prompt", { callSite });

  assertEquals(result.content, "pattern fallback");
});

Deno.test("[fixture_miss] a missing call site with no patterns throws, naming the call site", async () => {
  const provider = new MockLLMProvider(MockStrategy.RECORDED, {
    recordings: [],
    patterns: [],
  });
  const callSite: ICallSite = { scenarioId: "flow_blueprints", stepId: "missing-step", callIndex: 0 };

  await assertRejects(
    async () => await provider.generate("some prompt", { callSite }),
    MockLLMError,
    "flow_blueprints/missing-step#0",
  );
});
