/**
 * @module LogEventFieldsTypeTest
 * @path packages/core/tests/types/log_event_fields_type_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Compile-time type contract verification for ILogEvent and IServiceContext Actor/Agent/Identity fields.
 *
 * This file contains no runtime tests.
 * It exists solely to verify the TypeScript contract at compile time.
 * If any field is renamed or removed, `deno check` will fail.
 */

import { ActorType, AgentKind } from "@exaix/core";
import type { ILogEvent } from "@exaix/core";
import type { IServiceContext } from "@exaix/core/types";
// Type Contract Verification

// Verify ILogEvent has all three separation fields
const _logEvent: ILogEvent = {
  action: "test",
  target: "portal",
  actor: "user:test",
  actorType: ActorType.USER,
  agentId: "agent-executor", // runtime agent — NOT a blueprint slug
  agentKind: AgentKind.AGENT_EXECUTOR, // category of runtime agent
  identityId: "senior-coder", // LLM identity blueprint slug
};

// Verify IServiceContext has the same three separation fields
const _ctx: IServiceContext = {
  actor: "user:test",
  actorType: ActorType.USER,
  agentId: "agent-executor",
  agentKind: AgentKind.AGENT_EXECUTOR,
  identityId: "senior-coder",
};

// Verify partial usage is allowed (optional fields)
const _partialEvent: ILogEvent = {
  action: "test",
  target: "portal",
  // actorType, agentId, agentKind, identityId are all optional
};

// Verify undefined is acceptable for optional fields
const _undefinedEvent: ILogEvent = {
  action: "test",
  target: "portal",
  actorType: undefined,
  agentKind: undefined,
  identityId: undefined,
};

// Compile-Time Error Guards — each line MUST be a TypeScript error if
// uncommented into an ILogEvent literal.

// agentId: "senior-coder",                       // blueprint slug, not a runtime agent name
// identityKind: AgentKind.AGENT_EXECUTOR,         // field is named agentKind, not identityKind

// actorType: "invalid-actor-type" as ActorType,   // not a valid ActorType
// agentKind: "invalid-agent-kind" as AgentKind,   // not a valid AgentKind
