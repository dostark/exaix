/**
 * @module DaemonNetAllowlistCoversProvidersTest
 * @path tests/daemon/net_allowlist_covers_providers_test.ts
 * @description Phase 142 Step 7 — the daemon's default outbound allowlist must reach every
 *   provider the product ships.
 *
 *   The first live nightly run failed on `Requires net access to
 *   "generativelanguage.googleapis.com:443"`. `@exaix/ai-google` is a shipped provider,
 *   `gemini-flash-latest` is a default model in the registry floor, and `ProviderSelector` will
 *   choose it — but `DAEMON_DEFAULT_NET_HOSTS` listed only Anthropic, OpenAI and local Ollama. The
 *   daemon did not refuse on policy; it crashed the step with a permission error, and the request
 *   failed several layers from the cause. OpenRouter was missing for the same reason.
 *
 *   The second half is a duplicate source of truth: `apps/daemon/main.ts` logged the effective
 *   allowlist as a hardcoded string literal rather than from the constant, so the journal would
 *   have kept reporting the old three hosts after the list changed — the same shape as the
 *   `paths.flows` defect in Step 15, where three tables described one directory layout and two
 *   were wrong.
 *
 *   Widening an outbound allowlist is a security-relevant change, so it is bounded deliberately:
 *   hosts are added only for providers this repository ships and registers at bootstrap, each
 *   traced to that provider's own base-URL constant.
 * @architectural-layer Test
 * @related-files [packages/core/src/types/constants.ts, apps/daemon/main.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { DAEMON_DEFAULT_NET_HOSTS } from "@exaix/core";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");

/** Each shipped provider package and the host its default base URL resolves to. */
const SHIPPED_PROVIDER_HOSTS: readonly { provider: string; host: string }[] = [
  { provider: "ai-anthropic", host: "api.anthropic.com" },
  { provider: "ai-openai", host: "api.openai.com" },
  { provider: "ai-google", host: "generativelanguage.googleapis.com" },
  { provider: "ai-openrouter", host: "openrouter.ai" },
];

Deno.test("[security] the default allowlist covers every shipped provider host", () => {
  const missing = SHIPPED_PROVIDER_HOSTS
    .filter(({ host }) => !DAEMON_DEFAULT_NET_HOSTS.some((entry) => entry.split(":")[0] === host))
    .map(({ provider, host }) => `${provider} -> ${host}`);

  assertEquals(
    missing.sort(),
    [],
    `the daemon crashes a step with a permission error for these, rather than refusing on policy:\n${
      missing.join("\n")
    }`,
  );
});

Deno.test("[security] each provider's declared base URL still resolves to the host we allow", async () => {
  // Guards against the allowlist and the provider drifting apart: a provider that changes its
  // endpoint would otherwise be silently blocked again.
  const mismatched: string[] = [];
  for (const { provider, host } of SHIPPED_PROVIDER_HOSTS) {
    const constants = await Deno.readTextFile(join(REPO_ROOT, "packages", provider, "src", "constants.ts"))
      .catch(() => null);
    if (constants === null) continue; // not shipped in this checkout
    if (!constants.includes(host)) mismatched.push(`${provider}: no base URL mentioning ${host}`);
  }
  assertEquals(mismatched.sort(), [], mismatched.join("\n"));
});

Deno.test("[security] the allowlist is not silently unbounded", () => {
  // A wildcard or an empty list would make the whole allowlist meaningless; the point of widening
  // it for real providers is that it stays a list.
  assert(DAEMON_DEFAULT_NET_HOSTS.length > 0, "an empty default list blocks every provider");
  const wildcards = DAEMON_DEFAULT_NET_HOSTS.filter((host) => host.includes("*"));
  assertEquals(wildcards, [], "wildcards would defeat the allowlist");
});

Deno.test("[security] the daemon logs the allowlist from the constant, not a literal", async () => {
  // `main.ts` printed the three hosts as a hardcoded string, so the journal would have kept
  // reporting the old list after the constant changed — a second source of truth for one fact.
  const main = await Deno.readTextFile(join(REPO_ROOT, "apps", "daemon", "main.ts"));
  const stale = main.match(/hosts:\s*"api\.anthropic\.com[^"]*"/);
  assertEquals(stale, null, `main.ts hardcodes the allowlist: ${stale?.[0]}`);
  assert(
    main.includes("DAEMON_DEFAULT_NET_HOSTS"),
    "the default-allowlist log must read the constant it describes",
  );
});
