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
