/**
 * @module SessionPackage
 * @path packages/session/src/mod.ts
 * @description Barrel export for the @exaix/session package. Grows per Phase 106
 *   implementation step; currently exposes the adapter contract and registry.
 * @architectural-layer Services
 * @related-files [packages/session/src/i_session_adapter.ts, packages/session/src/session_delegate_service.ts]
 */

export type { ISessionAdapter, ISessionLaunch } from "./i_session_adapter.ts";
export {
  BuiltinSessionAdapter,
  createDefaultSessionAdapterRegistry,
  SessionAdapterRegistry,
} from "./session_adapter_registry.ts";
export type {
  IPrepareBriefInput,
  ISessionClock,
  ISessionDelegateService,
  ISessionPathSafety,
} from "./i_session_delegate.ts";
export {
  defaultSessionPathSafety,
  generateResumeToken,
  type ISessionDelegateServiceDeps,
  SessionDelegateService,
  systemClock,
} from "./session_delegate_service.ts";
