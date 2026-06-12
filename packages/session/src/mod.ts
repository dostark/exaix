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
import { assertBinaryAllowed, sanitizeChildEnv } from "./supervised_launch.ts";
import { sessionReturnToCostRecord } from "./cost_mapping.ts";
import type { ISessionCostInput } from "./cost_mapping.ts";
import { resolveSessionDelegateConfig } from "./config_resolver.ts";
import type { ISessionDelegateScopes } from "./config_resolver.ts";
import type { ISessionDelegateEventPayload } from "./event_payload.ts";

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
export { sessionReturnToCostRecord };
export type { ISessionCostInput };
export { resolveSessionDelegateConfig };
export type { ISessionDelegateScopes };
export type { ISessionDelegateEventPayload };
