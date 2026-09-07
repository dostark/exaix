/**
 * @module StubCatalogServers
 * @path tests/integration/helpers/stub_catalog_servers.ts
 * @description Phase 135 Step 9 — local HTTP stubs for the five Team model-registry
 *   catalog adapters (anthropic, openai, google, ollama, openrouter), each serving the
 *   exact response shape its adapter Zod-validates (see
 *   exaix-team/packages/model-registry-live/src/adapters/*_catalog_adapter.ts). Used with the
 *   model_registry.adapter_base_urls config override so a REAL booted daemon subprocess
 *   fetches from these stubs instead of the vendor hosts.
 * @architectural-layer Test
 * @related-files [apps/daemon/src/bootstrap_team.ts, tests/integration/helpers/daemon_config.ts]
 */
import type { JSONObject } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/** One running stub server + the base URL a config override should point at. */
export interface IStubCatalogServer {
  provider: string;
  baseUrl: string;
  /** Total requests this stub has received since it started. */
  requestCount(): number;
  shutdown(): Promise<void>;
}

function jsonResponse(body: JSONObject): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** Anthropic GET /v1/models — one admitted-curated model + one auto-admit candidate. */
function anthropicHandler(): (req: Request) => Response {
  return (req: Request) => {
    if (new URL(req.url).pathname !== "/v1/models") return new Response("not found", { status: 404 });
    return jsonResponse({
      data: [
        {
          id: "claude-stub-curated",
          display_name: "Claude Stub Curated",
          created_at: "2026-01-01T00:00:00Z",
          max_input_tokens: 200_000,
          max_tokens: 8192,
          capabilities: { thinking: { supported: true }, effort: { supported: true } },
        },
        {
          id: "claude-stub-explicit-use",
          display_name: "Claude Stub Explicit Use",
          created_at: "2026-01-01T00:00:00Z",
          max_input_tokens: 100_000,
          max_tokens: 4096,
        },
      ],
    });
  };
}

// OpenAI GET /v1/models — thin list (id + created only, per adapter's overlay reliance).
// `collidingModel`, if given, additionally serves a second entry sharing that model id —
// used to seed a 2-route model_catalog.
function openAiHandler(collidingModel: Opt<string, Reason.OptionalInput>): (req: Request) => Response {
  return (req: Request) => {
    if (new URL(req.url).pathname !== "/v1/models") return new Response("not found", { status: 404 });
    const data = [{ id: "gpt-stub-curated", created: 1_735_689_600 }];
    if (collidingModel) {
      data.push({ id: collidingModel, created: 1_735_689_600 });
    }
    return jsonResponse({ data });
  };
}

/** Google GET /v1beta/models — "models/" name prefix, per adapter's strip logic. */
function googleHandler(): (req: Request) => Response {
  return (req: Request) => {
    if (new URL(req.url).pathname !== "/v1beta/models") return new Response("not found", { status: 404 });
    return jsonResponse({
      models: [{
        name: "models/gemini-stub-curated",
        displayName: "Gemini Stub Curated",
        inputTokenLimit: 1_000_000,
        outputTokenLimit: 8192,
      }],
    });
  };
}

/** Ollama GET /api/tags — local, no credential, $0 pricing per adapter. */
function ollamaHandler(): (req: Request) => Response {
  return (req: Request) => {
    if (new URL(req.url).pathname !== "/api/tags") return new Response("not found", { status: 404 });
    return jsonResponse({
      models: [{
        name: "llama-stub-curated",
        details: { parameter_size: "8B", quantization_level: "Q4_0", family: "llama" },
      }],
    });
  };
}

/** OpenRouter GET /api/v1/models — aggregator, carries its own per-Mtok pricing. */
function openRouterHandler(): (req: Request) => Response {
  return (req: Request) => {
    if (new URL(req.url).pathname !== "/api/v1/models") return new Response("not found", { status: 404 });
    return jsonResponse({
      data: [{
        id: "stub-vendor/router-model",
        name: "Router Stub Model",
        context_length: 128_000,
        top_provider: { max_completion_tokens: 4096 },
        pricing: { prompt: "0.000001", completion: "0.000002" },
      }],
    });
  };
}

const HANDLERS: Record<string, (collidingModel: Opt<string, Reason.OptionalInput>) => (req: Request) => Response> = {
  anthropic: anthropicHandler,
  openai: openAiHandler,
  google: googleHandler,
  ollama: ollamaHandler,
  openrouter: openRouterHandler,
};

const HTTP_INTERNAL_SERVER_ERROR = 500;

/** Start one stub HTTP server for `provider` on an ephemeral port. `fail` forces every request to 500. */
function startOne(
  provider: string,
  fail: boolean,
  collidingModel: Opt<string, Reason.OptionalInput>,
): IStubCatalogServer {
  const build = HANDLERS[provider];
  if (!build) throw new Error(`no stub handler for provider "${provider}"`);
  const handler = build(collidingModel);
  let hits = 0;
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req: Request) => {
    hits++;
    if (fail) return new Response("stub-injected failure", { status: HTTP_INTERNAL_SERVER_ERROR });
    return handler(req);
  });
  const addr = server.addr as Deno.NetAddr;
  return {
    provider,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requestCount: () => hits,
    shutdown: () => server.shutdown(),
  };
}

// Start all five provider stubs. `failProvider`, if given, forces that provider's server to
// return HTTP 500 for every request (adapter-failure isolation); the rest behave normally.
// `options.collidingModel`, if given, makes the OpenAI stub also serve a model sharing that id.
export function startAllStubCatalogServers(
  failProvider?: Opt<string, Reason.OptionalInput>,
  options?: Opt<{ collidingModel?: string }, Reason.OptionalInput>,
): {
  servers: IStubCatalogServer[];
  adapterBaseUrls: Record<string, string>;
} {
  const servers = Object.keys(HANDLERS).map((provider) =>
    startOne(provider, provider === failProvider, options?.collidingModel)
  );
  const adapterBaseUrls = Object.fromEntries(servers.map((s) => [s.provider, s.baseUrl]));
  return { servers, adapterBaseUrls };
}

export async function shutdownAll(servers: IStubCatalogServer[]): Promise<void> {
  await Promise.all(servers.map((s) => s.shutdown()));
}
