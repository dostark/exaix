/**
 * @module ServiceContextTypeTest
 * @path packages/core/tests/service_context_type_test.ts
 * @description Compile-time verification for the @exaix/core service context contract.
 *
 * This file contains no runtime tests.
 * It exists solely to verify the TypeScript contract at compile time.
 */

import { ActorType, AgentKind } from "@exaix/core";
import type { IServiceContext } from "@exaix/core";

const _ctx: IServiceContext = {
  actor: "user:test",
  actorType: ActorType.USER,
  agentId: "agent-executor",
  agentKind: AgentKind.AGENT_EXECUTOR,
  identityId: "senior-coder",
  traceId: crypto.randomUUID(),
};

const _partialContext: IServiceContext = {
  identityId: "reviewer",
};
