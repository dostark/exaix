/**
 * @module ConfigResolver
 * @path packages/session/src/config_resolver.ts
 * @description Phase 106 Step 9 — GAP-7 precedence resolution for the
 *   [session_delegate] config across scopes. Most specific wins:
 *   request → blueprint → portal → global. Returns undefined when no scope
 *   supplies a config (delegation stays disabled by default).
 * @architectural-layer Services
 * @dependencies [@exaix/schemas]
 * @related-files [packages/schemas/src/config.ts, packages/schemas/src/session_delegate.ts]
 */

import type { SessionDelegateConfig } from "@exaix/schemas/session_delegate.ts";

/** The four scopes a [session_delegate] block can be attached at. */
export interface ISessionDelegateScopes {
  global?: SessionDelegateConfig;
  portal?: SessionDelegateConfig;
  blueprint?: SessionDelegateConfig;
  request?: SessionDelegateConfig;
}

/**
 * Resolve the effective session-delegate config (most specific scope wins).
 * Precedence: request → blueprint → portal → global.
 */
export function resolveSessionDelegateConfig(scopes: ISessionDelegateScopes): SessionDelegateConfig | undefined {
  return scopes.request ?? scopes.blueprint ?? scopes.portal ?? scopes.global;
}
