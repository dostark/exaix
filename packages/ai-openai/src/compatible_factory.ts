/**
 * @module OpenAICompatibleProviderFactory
 * @path packages/ai-openai/src/compatible_factory.ts
 * @description Creates the local-test OpenAI-compatible provider with isolated endpoint and credential policy.
 * @architectural-layer AI
 * @dependencies [@exaix/ai, @exaix/core, @exaix/schemas]
 * @related-files [packages/ai-openai/src/openai_provider.ts, packages/ai/src/errors.ts]
 */
import { PROVIDER_REASON_PROFILE_MISMATCH, ProviderFactoryError } from "@exaix/ai/errors.ts";
import { AbstractKeyBasedProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import type { CompatibleChatConfig } from "@exaix/schemas";
import { OpenAIProvider } from "./openai_provider.ts";
import {
  DEFAULT_OPENAI_RETRY_BACKOFF_MS,
  DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
  DEFAULT_OPENAI_TIMEOUT_MS,
} from "./constants.ts";
import {
  OPENAI_COMPATIBLE_LOCAL_PROFILE,
  OPENAI_COMPATIBLE_PROFILE_DEFAULTS,
  PricingTier,
  ProviderCostTier,
  ProviderType,
  SecureCredentialStore,
} from "@exaix/core";
import { AiTokenEstimatorTokenizer, type ITokenizer } from "@exaix/core/func";
import type { IModelPricingLookup, Opt, Reason } from "@exaix/core/types";

export const PROVIDER_OPENAI_CHAT = ProviderType.OPENAI_CHAT;
export const OPENAI_CHAT_DEFAULTS = {
  defaultModel: "gpt-4.1-mini-2025-04-14",
  defaultEndpoint: "",
  defaultTimeoutMs: DEFAULT_OPENAI_TIMEOUT_MS,
  defaultRetryMaxAttempts: DEFAULT_OPENAI_RETRY_MAX_ATTEMPTS,
  defaultRetryBackoffMs: DEFAULT_OPENAI_RETRY_BACKOFF_MS,
} as const;
export const OPENAI_CHAT_PROVIDER_METADATA = {
  name: PROVIDER_OPENAI_CHAT,
  description: "Local OpenAI-compatible Chat Completions fixture transport",
  capabilities: ["chat", "tools"],
  costTier: ProviderCostTier.PAID,
  pricingTier: PricingTier.MEDIUM,
  strengths: ["coding"],
  supportsNativeTools: true,
  supportsNativeConversation: true,
  chatFormat: "openai",
} as const;

const LOCAL_TEST_KEY_ENV = "EXA_COMPAT_TEST_API_KEY";
const LOCAL_TEST_MODEL = "compat-fixture-v1";
const LOCAL_TEST_ENDPOINT = /^http:\/\/127\.0\.0\.1:[0-9]+\/v1\/chat\/completions$/;

type RemoteCompatibleProfile = "openai" | "deepseek";

/** Fixed profile → credential env var. Never derived from user input. */
const REMOTE_PROFILE_KEY_ENV: Record<RemoteCompatibleProfile, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

/** Qualified host per remote profile, derived from the single source of truth
 *  (`OPENAI_COMPATIBLE_PROFILE_DEFAULTS`) rather than a second hardcoded literal. */
const REMOTE_PROFILE_HOST: Record<RemoteCompatibleProfile, string> = {
  openai: new URL(OPENAI_COMPATIBLE_PROFILE_DEFAULTS.openai.endpoint).host,
  deepseek: new URL(OPENAI_COMPATIBLE_PROFILE_DEFAULTS.deepseek.endpoint).host,
};

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

/** Pinned qualified model per profile — the only model each profile may select. */
function pinnedModel(profile: CompatibleChatConfig["profile"]): string {
  return profile === OPENAI_COMPATIBLE_LOCAL_PROFILE
    ? LOCAL_TEST_MODEL
    : OPENAI_COMPATIBLE_PROFILE_DEFAULTS[profile].model;
}

/** Normalizes a remote profile's root, `/v1` base, or full endpoint to its qualified URL. */
function remoteEndpoint(profile: RemoteCompatibleProfile, rawEndpoint: string): URL {
  let url: URL;
  try {
    url = new URL(rawEndpoint);
  } catch {
    throw new ProviderFactoryError(`Compatible ${profile} endpoint is invalid`, PROVIDER_REASON_PROFILE_MISMATCH);
  }
  const path = url.pathname.replace(/\/$/, "");
  if (
    url.protocol !== "https:" || url.host !== REMOTE_PROFILE_HOST[profile] ||
    url.username || url.password || url.search || url.hash ||
    (path !== "" && path !== "/v1" && path !== CHAT_COMPLETIONS_PATH)
  ) {
    throw new ProviderFactoryError(
      `Compatible ${profile} endpoint must use its qualified HTTPS host and documented path`,
      PROVIDER_REASON_PROFILE_MISMATCH,
    );
  }
  return new URL(`https://${REMOTE_PROFILE_HOST[profile]}${CHAT_COMPLETIONS_PATH}`);
}

type PermissionKind = "env" | "net";
type PermissionState = "granted" | "denied" | "prompt";
type PermissionStateReader = (kind: PermissionKind, value: string) => Promise<PermissionState>;

async function readDenoPermission(kind: PermissionKind, value: string): Promise<PermissionState> {
  const permission = kind === "env"
    ? await Deno.permissions.query({ name: "env", variable: value })
    : await Deno.permissions.query({ name: "net", host: value });
  return permission.state;
}

function localEndpoint(endpoint: string, allowInsecure: boolean): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ProviderFactoryError("Compatible local-test endpoint is invalid", PROVIDER_REASON_PROFILE_MISMATCH);
  }
  const loopback = url.hostname === "127.0.0.1";
  if (
    !loopback || !LOCAL_TEST_ENDPOINT.test(endpoint) || !allowInsecure ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new ProviderFactoryError(
      "Compatible local-test endpoint must use explicit loopback host and port",
      PROVIDER_REASON_PROFILE_MISMATCH,
    );
  }
  return url;
}

export class OpenAICompatibleProviderFactory extends AbstractKeyBasedProviderFactory {
  constructor(
    private readonly readPermission: PermissionStateReader = readDenoPermission,
    private readonly tokenizer: ITokenizer = new AiTokenEstimatorTokenizer(),
    private readonly pricingLookup?: Opt<IModelPricingLookup, Reason.OptionalDependency>,
  ) {
    super(LOCAL_TEST_KEY_ENV);
  }

  override async create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const compatible = options.compatible;
    if (!compatible) {
      throw new ProviderFactoryError(
        "Compatible profile is unsupported in this phase",
        PROVIDER_REASON_PROFILE_MISMATCH,
      );
    }
    const model = pinnedModel(compatible.profile);
    if (
      options.model !== model || (compatible.model !== undefined && compatible.model !== model) ||
      options.apiKey !== undefined
    ) {
      throw new ProviderFactoryError(
        "Compatible model or credential tuple is invalid",
        PROVIDER_REASON_PROFILE_MISMATCH,
      );
    }
    if (options.id !== undefined && options.id !== `openai-chat-${options.model}`) {
      throw new ProviderFactoryError(
        "Compatible provider identity has an invalid prefix",
        PROVIDER_REASON_PROFILE_MISMATCH,
      );
    }
    const endpoint = compatible.profile === OPENAI_COMPATIBLE_LOCAL_PROFILE
      ? localEndpoint(compatible.endpoint ?? "", compatible.allow_insecure_loopback)
      : remoteEndpoint(compatible.profile, compatible.endpoint ?? "");
    const defaultPort = endpoint.protocol === "https:" ? "443" : "80";
    try {
      if (await this.readPermission("net", `${endpoint.hostname}:${endpoint.port || defaultPort}`) !== "granted") {
        throw new ProviderFactoryError(
          "Permission to reach the compatible endpoint is required",
          "net_permission_denied",
        );
      }
    } catch (error) {
      if (error instanceof ProviderFactoryError) throw error;
      throw new ProviderFactoryError(
        "Permission to reach the compatible endpoint is required",
        "net_permission_denied",
      );
    }
    const key = compatible.profile === OPENAI_COMPATIBLE_LOCAL_PROFILE
      ? await this.readKey(LOCAL_TEST_KEY_ENV, false)
      : await this.readKey(REMOTE_PROFILE_KEY_ENV[compatible.profile], true);

    const resolvedCompatible: CompatibleChatConfig = compatible;
    return new OpenAIProvider({
      apiKey: key,
      model: options.model,
      baseUrl: endpoint.href.replace(/\/$/, ""),
      id: options.id ?? `openai-chat-${options.model}`,
      logger: options.logger,
      config: options.config,
      timeoutMs: options.timeoutMs,
      tokenizer: this.tokenizer,
      pricingLookup: this.pricingLookup,
      compatible: resolvedCompatible,
    });
  }

  /** Reads the fixed env var first, then a remote-only read-only store fallback. */
  private async readKey(envKey: string, allowStoreFallback: boolean): Promise<string> {
    let key: string | undefined;
    try {
      if (await this.readPermission("env", envKey) !== "granted") {
        throw new ProviderFactoryError("Permission to read compatible credential is required", "env_permission_denied");
      }
      key = Deno.env.get(envKey);
    } catch (error) {
      if (error instanceof ProviderFactoryError) throw error;
      throw new ProviderFactoryError("Permission to read compatible credential is required", "env_permission_denied");
    }
    if (!key && allowStoreFallback) key = (await SecureCredentialStore.get(envKey)) ?? undefined;
    if (!key) throw new ProviderFactoryError("Compatible credential is missing", "credential_missing");

    return key;
  }
}
