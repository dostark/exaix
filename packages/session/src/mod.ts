/**
 * @module SessionPackage
 * @path packages/session/src/mod.ts
 * @description Barrel export for the @exaix/session package. Grows per Phase 106
 *   implementation step; currently exposes the adapter contract and registry.
 * @architectural-layer Services
 * @related-files [packages/session/src/i_session_adapter.ts, packages/session/src/session_delegate_service.ts]
 */

import { type IReconcileInput, type IReconcileResult, reconcile } from "./reconcile.ts";
import type { ISessionAdapter, ISessionLaunch } from "./i_session_adapter.ts";
import {
  BuiltinSessionAdapter,
  createDefaultSessionAdapterRegistry,
  SessionAdapterRegistry,
} from "./session_adapter_registry.ts";
import type {
  IPrepareBriefInput,
  ISessionClock,
  ISessionDelegateService,
  ISessionPathSafety,
} from "./i_session_delegate.ts";
import {
  defaultSessionPathSafety,
  generateResumeToken,
  type ISessionDelegateServiceDeps,
  SessionDelegateService,
  systemClock,
} from "./session_delegate_service.ts";
import { checkScope, type IScopeCheckResult } from "./scope_checker.ts";
import { constantTimeEqual } from "./constant_time.ts";
import { SessionWaitStore } from "./wait/session_wait_store.ts";
import type { ISessionWaitStore } from "./wait/i_session_wait_store.ts";
import { SessionReturnProcessor } from "./session_return_processor.ts";
import type { ISessionReturnOutcome, ISessionReturnProcessorDeps } from "./session_return_processor.ts";
import {
  buildAmendmentDecision,
  buildClarificationFromDelegation,
  buildReviewDecisionPatch,
  sessionDecisionToAmendmentVerdict,
  sessionDecisionToReviewStatus,
} from "./gate_mappers.ts";
import type { IAmendmentDecisionInput, IRefinementClarificationInput, IReviewDecisionPatch } from "./gate_mappers.ts";
import {
  defaultSpawnVersion,
  type IDelegateVersionProbeDeps,
  type IDelegateVersionResult,
  probeDelegateVersion,
} from "./delegate_version_probe.ts";
import { assertBinaryAllowed, sanitizeChildEnv } from "./supervised_launch.ts";
import { parseDelegateStdout } from "./delegate_return_parser.ts";
import type { IDelegateParsedReturn } from "./delegate_return_parser.ts";
import { sessionReturnToCostRecord } from "./cost_mapping.ts";
import type { ISessionCostInput } from "./cost_mapping.ts";
import {
  assertPathsWithinWorktree,
  buildOpencodePermissionConfig,
  generateOpencodePermissionConfig,
} from "./opencode_permission_generator.ts";
import type { IOpencodePermissionConfig } from "./opencode_permission_generator.ts";
import { deriveClaudeToolFlags } from "./claude_permission_flags.ts";
import { deriveCodexSandboxFlags } from "./codex_sandbox_flags.ts";
import { resolveSessionDelegateConfig } from "./config_resolver.ts";
import type { ISessionDelegateScopes } from "./config_resolver.ts";
import type { ISessionDelegateEventPayload } from "./event_payload.ts";
import { SessionBriefReader } from "./session_brief_reader.ts";
import type { ISessionBriefReader } from "./session_brief_reader.ts";
import {
  buildSessionDelegationOutcome,
  SessionDelegateLaunchedPayloadSchema,
  SessionDelegationOutcomeSchema,
  SessionDelegationResultRecordSchema,
  SessionDelegationResultStateSchema,
  SessionDelegationStatusSchema,
} from "./session_delegation.ts";
import type {
  IBuildSessionDelegationOutcomeInput,
  ISessionDelegateLaunchedPayload,
  ISessionDelegationCoordinator,
  ISessionDelegationOutcome,
  ISessionDelegationRequest,
  ISessionDelegationResultRecord,
} from "./session_delegation.ts";
import { SessionDelegationResultStore } from "./session_delegation_result_store.ts";
import type { ISessionDelegationResultStore } from "./session_delegation_result_store.ts";
import {
  ContextRecordAlreadyExistsError,
  ContextRecordSecurityError,
  ContextRecordStore,
  isValidUuid,
} from "./context_record_store.ts";
import type { IContextRecordPathResolver } from "./context_record_store.ts";
import { DOGFOOD_MCP_SERVER_KEY } from "./dogfood_mcp_config.ts";

export { type IReconcileInput, type IReconcileResult, reconcile };
export type { ISessionAdapter, ISessionLaunch };
export { BuiltinSessionAdapter, createDefaultSessionAdapterRegistry, SessionAdapterRegistry };
export type { IPrepareBriefInput, ISessionClock, ISessionDelegateService, ISessionPathSafety };
export {
  defaultSessionPathSafety,
  generateResumeToken,
  type ISessionDelegateServiceDeps,
  SessionDelegateService,
  systemClock,
};
export { checkScope, type IScopeCheckResult };
export { constantTimeEqual };
export { SessionWaitStore };
export type { ISessionWaitStore };
export { SessionReturnProcessor };
export type { ISessionReturnOutcome, ISessionReturnProcessorDeps };
export {
  buildAmendmentDecision,
  buildClarificationFromDelegation,
  buildReviewDecisionPatch,
  sessionDecisionToAmendmentVerdict,
  sessionDecisionToReviewStatus,
};
export type { IAmendmentDecisionInput, IRefinementClarificationInput, IReviewDecisionPatch };
export { assertBinaryAllowed, sanitizeChildEnv };
export { defaultSpawnVersion, probeDelegateVersion };
export { deriveClaudeToolFlags };
export { deriveCodexSandboxFlags };
export type { IDelegateVersionProbeDeps, IDelegateVersionResult };
export { parseDelegateStdout };
export type { IDelegateParsedReturn };
export { sessionReturnToCostRecord };
export type { ISessionCostInput };
export { assertPathsWithinWorktree, buildOpencodePermissionConfig, generateOpencodePermissionConfig };
export type { IOpencodePermissionConfig };
export { resolveSessionDelegateConfig };
export type { ISessionDelegateScopes };
export type { ISessionDelegateEventPayload };
export { SessionBriefReader };
export type { ISessionBriefReader };
export {
  buildSessionDelegationOutcome,
  SessionDelegateLaunchedPayloadSchema,
  SessionDelegationOutcomeSchema,
  SessionDelegationResultRecordSchema,
  SessionDelegationResultStateSchema,
  SessionDelegationStatusSchema,
};
export type {
  IBuildSessionDelegationOutcomeInput,
  ISessionDelegateLaunchedPayload,
  ISessionDelegationCoordinator,
  ISessionDelegationOutcome,
  ISessionDelegationRequest,
  ISessionDelegationResultRecord,
};
export { SessionDelegationResultStore };
export type { ISessionDelegationResultStore };
export { ContextRecordAlreadyExistsError, ContextRecordSecurityError, ContextRecordStore, isValidUuid };
export type { IContextRecordPathResolver };
export { DOGFOOD_MCP_SERVER_KEY };
