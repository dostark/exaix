/**
 * @module ServiceContextTypeTest
 * @path packages/core/tests/service_context_type_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Compile-time verification for the @exaix/core service context contract.
 *
 * This file contains no runtime tests.
 * It exists solely to verify the TypeScript contract at compile time.
 */

import { ActorType, RunnerKind } from "@exaix/core";
import type { IServiceContext } from "@exaix/core";

const _ctx: IServiceContext = {
  actor: "user:test",
  actorType: ActorType.USER,
  runnerId: "agent-composer",
  runnerKind: RunnerKind.AGENT_COMPOSER,
  agentRole: "senior-coder",
  traceId: crypto.randomUUID(),
};

const _partialContext: IServiceContext = {
  agentRole: "reviewer",
};
