/**
 * @module DelegateProviderEnv
 * @path packages/session/src/delegate_provider_env.ts
 * @description Maps a delegate provider block to the env a session tool needs to reach that
 *   provider, and reads the key from a named variable. Shared by the session delegate and the
 *   CLI delegate. Package-pure: the caller supplies the variable reader.
 * @architectural-layer Services
 * @dependencies [@exaix/schemas, @exaix/core]
 * @related-files [packages/session/src/session_delegate_service.ts, packages/execution/src/agent_composer.ts]
 */

import { PROVIDER_ANTHROPIC, PROVIDER_OLLAMA, PROVIDER_OPENROUTER } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { SessionDelegateProvider } from "@exaix/schemas/session_delegate.ts";
import { TOOL_CLAUDE_CODE, TOOL_OPENCODE } from "./constants.ts";

const OPENROUTER_ANTHROPIC_BASE_URL = "https://openrouter.ai/api";

/** Env a tool needs to use `provider` with `apiKey`. An unknown provider or tool needs none. */
export function resolveDelegateProviderEnv(
  provider: SessionDelegateProvider,
  tool: string,
  apiKey: string,
): Record<string, string> {
  if (provider.name === PROVIDER_OPENROUTER) {
    if (tool === TOOL_OPENCODE) return { OPENROUTER_API_KEY: apiKey };
    if (tool === TOOL_CLAUDE_CODE) {
      return {
        ANTHROPIC_BASE_URL: provider.base_url ?? OPENROUTER_ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_API_KEY: "",
      };
    }
    return {};
  }
  if (provider.name === PROVIDER_ANTHROPIC) return { ANTHROPIC_API_KEY: apiKey };
  if (provider.name === PROVIDER_OLLAMA) return {};
  return {};
}

/** Reads the key from `provider.key_env` and maps it. A missing or empty key is a config error. */
export function readDelegateProviderEnv(
  provider: SessionDelegateProvider,
  tool: string,
  readEnv: (name: string) => Opt<string, Reason.OptionalInput>,
): Record<string, string> {
  const apiKey = readEnv(provider.key_env);
  if (!apiKey) {
    throw new Error(
      `delegate provider "${provider.name}" needs the environment variable ${provider.key_env}, which is not set`,
    );
  }
  return resolveDelegateProviderEnv(provider, tool, apiKey);
}
