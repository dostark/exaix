/**
 * @module HitlGovernanceHelpers
 * @path tests/integration/helpers/hitl_governance_helpers.ts
 * @description Shared ToolRegistry harness, approve-tracking interceptor, and decision-id
 *   helper for the HITL governance integration and security tests.
 * @architectural-layer Test
 * @related-files [tests/integration/hitl_governance_e2e_test.ts, tests/integration/hitl_governance_e2e_security_test.ts]
 */

import type { HitlPolicyEvaluator } from "@exaix-team/hitl";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig, initTestDbService } from "@exaix/testing";
import { EventLogger } from "@exaix/core/logger";
import type { IToolConfirmationInterceptor, Opt, Reason } from "@exaix/core/types";
import type { ToolConfirmationDecision, ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import type { HitlRule } from "@exaix/schemas/hitl.ts";

export function decisionId(): string {
  return crypto.randomUUID();
}

export class ApproveTrackingInterceptor implements IToolConfirmationInterceptor {
  requests: ToolConfirmationRequest[] = [];
  requestApproval(req: ToolConfirmationRequest): Promise<ToolConfirmationDecision> {
    this.requests.push(req);
    return Promise.resolve({
      id: decisionId(),
      approved: true,
      reason: "approved",
      decidedAt: new Date().toISOString(),
      decidedBy: "system:test",
    });
  }
}

export async function withRegistry(
  evaluator: Opt<HitlPolicyEvaluator, Reason.OptionalInput>,
  interceptor: Opt<IToolConfirmationInterceptor, Reason.OptionalInput>,
  blueprintRules: Opt<HitlRule[], Reason.OptionalInput>,
  fn: (registry: ToolRegistry) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "hitl-e2e-" });
  const { db, cleanup } = await initTestDbService();
  const config = createMockConfig(tempDir);
  const logger = new EventLogger({ db });

  try {
    const registry = new ToolRegistry({
      config,
      logger,
      hitlPolicyEvaluator: evaluator,
      confirmationInterceptor: interceptor,
      hitlBlueprintRules: blueprintRules,
    });
    await fn(registry);
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}
