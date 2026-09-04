/**
 * @module LogEventFieldsTypeTest
 * @path packages/core/tests/types/log_event_fields_type_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Compile-time type contract verification for ILogEvent and IServiceContext Actor/Agent/Agent Role fields.
 *
 * This file contains no runtime tests.
 * It exists solely to verify the TypeScript contract at compile time.
 * If any field is renamed or removed, `deno check` will fail.
 */

import { ActorType, RunnerKind } from "@exaix/core";
import type { ILogEvent } from "@exaix/core";
import type { IServiceContext } from "@exaix/core/types";
// Type Contract Verification

// Verify ILogEvent has all three separation fields
const _logEvent: ILogEvent = {
  action: "test",
  target: "portal",
  actor: "user:test",
  actorType: ActorType.USER,
  runnerId: "agent-composer", // runtime agent — NOT a blueprint slug
  runnerKind: RunnerKind.AGENT_COMPOSER, // category of runtime agent
  agentRole: "senior-coder", // LLM agent role blueprint slug
};

// Verify IServiceContext has the same three separation fields
const _ctx: IServiceContext = {
  actor: "user:test",
  actorType: ActorType.USER,
  runnerId: "agent-composer",
  runnerKind: RunnerKind.AGENT_COMPOSER,
  agentRole: "senior-coder",
};

// Verify partial usage is allowed (optional fields)
const _partialEvent: ILogEvent = {
  action: "test",
  target: "portal",
  // actorType, runnerId, runnerKind, agentRole are all optional
};

// Verify undefined is acceptable for optional fields
const _undefinedEvent: ILogEvent = {
  action: "test",
  target: "portal",
  actorType: undefined,
  runnerKind: undefined,
  agentRole: undefined,
};

// Compile-Time Error Guards — each line MUST be a TypeScript error if
// uncommented into an ILogEvent literal.

// runnerId: "senior-coder",                       // blueprint slug, not a runtime agent name
// identityKind: RunnerKind.AGENT_COMPOSER,       // field is named runnerKind, not identityKind

// actorType: "invalid-actor-type" as ActorType,   // not a valid ActorType
// runnerKind: "invalid-agent-kind" as RunnerKind, // not a valid RunnerKind
