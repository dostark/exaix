/**
 * @module CallSiteTransportTest
 * @path packages/request/tests/call_site_transport_test.ts
 * @description Phase 157 Step 1 — a request file carrying `scenario_id`/`step_id` frontmatter
 *   yields an `IModelOptions.callSite` that reaches the provider, threaded through
 *   `buildParsedRequest` (`IParsedRequest.scenarioId`/`stepId`) and `AgentRunner`. A request
 *   without those fields gets no `callSite` at all — the provider falls back to its existing
 *   whole-prompt-hash keying, unaffected by this transport.
 * @architectural-layer Services
 * @related-files [packages/request/src/common.ts, packages/execution/src/agent_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { buildParsedRequest } from "@exaix/request";
import { AgentRunner, type IBlueprint } from "@exaix/execution";
import type { IRequestFrontmatter } from "@exaix/core/request";
import { RequestStatus } from "@exaix/core/status";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types";

const BASE_FRONTMATTER = {
  priority: "normal",
  source: "test",
  status: RequestStatus.PENDING,
  trace_id: "trace-base",
  created: "2026-01-01T00:00:00.000Z",
  created_by: "test",
};

const blueprint: IBlueprint = { systemPrompt: "system prompt" };

class CapturingProvider implements IModelProvider {
  readonly id = "capturing";
  lastOptions?: IModelOptions;

  generate(_prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    this.lastOptions = options;
    return Promise.resolve({
      content: "<thought>ok</thought><content>ok</content>",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: "mock-model",
      provider: this.id,
    });
  }
}

Deno.test("[call_site_transport] scenario_id/step_id frontmatter reaches IModelOptions.callSite", async () => {
  const frontmatter: IRequestFrontmatter = {
    ...BASE_FRONTMATTER,
    scenario_id: "flow_blueprints",
    step_id: "submit-request",
  };
  const request = buildParsedRequest("do the thing", frontmatter, "req-1", "trace-1");
  const provider = new CapturingProvider();
  const runner = new AgentRunner(provider, { disableRetry: true });

  await runner.run(blueprint, request, undefined);

  assertEquals(provider.lastOptions?.callSite, {
    scenarioId: "flow_blueprints",
    stepId: "submit-request",
    callIndex: 0,
  });
});

Deno.test("[call_site_transport] a request without scenario_id/step_id gets no callSite", async () => {
  const frontmatter: IRequestFrontmatter = { ...BASE_FRONTMATTER };
  const request = buildParsedRequest("do the thing", frontmatter, "req-2", "trace-2");
  const provider = new CapturingProvider();
  const runner = new AgentRunner(provider, { disableRetry: true });

  await runner.run(blueprint, request, undefined);

  assertEquals(provider.lastOptions?.callSite, undefined);
});
