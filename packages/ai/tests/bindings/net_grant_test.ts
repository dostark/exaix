/**
 * @module NetGrantTest
 * @path packages/ai/tests/bindings/net_grant_test.ts
 * @description Step-7 coverage for the daemon's start-time network grant: with allow_net
 *   unset it grants every catalog host (built-in, config and .exa/overlays/), de-duplicated
 *   and sorted with normalized host:port; with allow_net set (including []) the explicit
 *   grant is preserved unchanged; invalid or symlinked catalog endpoints are rejected.
 * @architectural-layer AI
 * @related-files [packages/ai/src/bindings/net_grant.ts, packages/ai/src/bindings/binding_layers.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createMockConfig } from "@exaix/testing";
import type { Config } from "@exaix/schemas/config.ts";
import { computeStartNetGrant } from "@exaix/ai/bindings/net_grant.ts";

function configWith(root: string, overrides: Partial<Config> = {}): Config {
  return createMockConfig(root, overrides);
}

Deno.test("[net] unset allow_net grants every catalog host, bound or not", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "net-grant-" });
  try {
    const config = configWith(tempDir, {
      catalog: {
        models: {},
        services: {
          alpha: {
            adapter: "mock",
            transport: "cloud",
            interface: "api",
            serves: { "*": "{name}" },
            endpoint: "https://alpha.example.com/v1",
          },
          beta: {
            adapter: "mock",
            transport: "cloud",
            interface: "api",
            serves: { "*": "{name}" },
            endpoint: "https://beta.example.com:8443/v1",
          },
        },
      },
    });
    const grant = await computeStartNetGrant(config);
    // DAEMON_DEFAULT_NET_HOSTS hosts plus the two catalog hosts, deduped and sorted.
    assertEquals(grant.includes("alpha.example.com"), true);
    assertEquals(grant.includes("beta.example.com:8443"), true);
    assertEquals(grant.includes("api.anthropic.com"), true);
    assertEquals(new Set(grant).size, grant.length);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[net] a set allow_net is returned unchanged, including the empty array", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "net-grant-" });
  try {
    const explicit = configWith(tempDir, {
      system: {
        root: tempDir,
        log_level: "info" as never,
        schema_version: "1.0.0",
        allow_net: ["only.example.com:8080"],
      },
      catalog: {
        models: {},
        services: {
          alpha: {
            adapter: "mock",
            transport: "cloud",
            interface: "api",
            serves: { "*": "{name}" },
            endpoint: "https://other.example.com/v1",
          },
        },
      },
    });
    const grant = await computeStartNetGrant(explicit);
    assertEquals(grant, ["only.example.com:8080"]);
    assertEquals(grant.includes("other.example.com"), false);

    const blocked = configWith(tempDir, {
      system: { root: tempDir, log_level: "info" as never, schema_version: "1.0.0", allow_net: [] },
      catalog: { models: {}, services: {} },
    });
    const blockedGrant = await computeStartNetGrant(blocked);
    assertEquals(blockedGrant, []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[net][security] an invalid catalog endpoint is rejected before spawn", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "net-grant-" });
  try {
    const bad = configWith(tempDir, {
      catalog: {
        models: {},
        services: {
          alpha: {
            adapter: "mock",
            transport: "cloud",
            interface: "api",
            serves: { "*": "{name}" },
            endpoint: "http://userinfo@public.example.com/v1",
          },
        },
      },
    });
    await assertRejects(() => computeStartNetGrant(bad), Error, "endpoint");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[net][security] a symlinked catalog overlay is rejected", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "net-grant-" });
  try {
    const overlaysDir = join(tempDir, ".exa", "overlays");
    await Deno.mkdir(overlaysDir, { recursive: true });
    const outsideTarget = join(tempDir, "outside.json");
    await Deno.writeTextFile(outsideTarget, JSON.stringify({ schema: 1, catalog: {} }));
    await Deno.symlink(outsideTarget, join(overlaysDir, "catalog.json"));
    const config = configWith(tempDir);
    await assertRejects(() => computeStartNetGrant(config), Error, "overlay_invalid");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[net] daemon overlay catalog hosts are included in the grant", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "net-grant-" });
  try {
    const overlaysDir = join(tempDir, ".exa", "overlays");
    await Deno.mkdir(overlaysDir, { recursive: true });
    await Deno.writeTextFile(
      join(overlaysDir, "svc.json"),
      JSON.stringify({
        schema: 1,
        catalog: {
          services: {
            gamma: {
              adapter: "mock",
              transport: "cloud",
              interface: "api",
              serves: { "*": "{name}" },
              endpoint: "https://gamma.internal.example.com/v1",
            },
          },
        },
      }),
    );
    const config = configWith(tempDir);
    const grant = await computeStartNetGrant(config);
    assertEquals(grant.includes("gamma.internal.example.com"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("[phase203.sentinel] an unsubstituted sentinel endpoint is skipped, never granted", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "net-grant-sentinel-" });
  try {
    // The endpoint schema is a URL, so a validated config never carries the sentinel. This
    // asserts the defensive contract for a catalog that reaches the grant mid-substitution.
    const config = {
      ...configWith(tempDir),
      catalog: {
        models: {},
        services: {
          fixture: {
            adapter: "openai-chat",
            profile: "local-test",
            transport: "local",
            interface: "api",
            serves: { "*": "{name}" },
            endpoint: "http://127.0.0.1:__COMPAT_FIXTURE_PORT__/v1/chat/completions",
          },
        },
      },
    } as Config;

    const grant = await computeStartNetGrant(config);

    assertEquals(grant.some((entry) => entry.includes("__COMPAT_FIXTURE_PORT__")), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
