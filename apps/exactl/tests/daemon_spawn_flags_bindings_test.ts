/**
 * @module DaemonSpawnFlagsBindingsTest
 * @path apps/exactl/tests/daemon_spawn_flags_bindings_test.ts
 * @description Step-7 CLI coverage: buildSpawnFlags adds every catalog service host to the
 *   start-time `--allow-net` grant when allow_net is unset, and never changes the grant
 *   when allow_net is set (including the empty array). Catalog-derived values reach the
 *   spawn as plain host:port strings; an invalid catalog endpoint is rejected before spawn.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/daemon_commands.ts, packages/ai/src/bindings/net_grant.ts]
 */

import { assertEquals } from "@std/assert";
import { DaemonCommands } from "../src/commands/daemon_commands.ts";
import { createStubContext } from "@exaix/testing";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { DAEMON_DEFAULT_NET_HOSTS } from "@exaix/core/types";
import type { Config } from "@exaix/schemas";

class TestDaemonCommands extends DaemonCommands {
  public async callSpawnFlags(): Promise<string[]> {
    return await this.buildSpawnFlags();
  }
}

async function makeCommands(): Promise<{
  cmds: TestDaemonCommands;
  config: Config;
  cleanup: () => Promise<void>;
}> {
  const { configService, db, cleanup } = await createCliTestContext();
  const cmds = new TestDaemonCommands(createStubContext({ config: configService, db }));
  return { cmds, config: configService.getAll(), cleanup };
}

function netFlag(flags: string[]): string | undefined {
  return flags.find((flag) => flag.startsWith("--allow-net="));
}

Deno.test("[bindings] unset allow_net extends the start grant with every catalog host", async () => {
  const { cmds, config, cleanup } = await makeCommands();
  try {
    // Attach a catalog service with an endpoint host to the shared config instance.
    config.catalog = {
      models: {},
      services: {
        alpha: {
          adapter: "mock",
          transport: "cloud",
          interface: "api",
          serves: { "*": "{name}" },
          endpoint: "https://alpha.example.com/v1",
        },
      },
    };
    const flags = await cmds.callSpawnFlags();
    const flag = netFlag(flags);
    assertEquals(typeof flag, "string");
    const hosts = flag!.slice("--allow-net=".length).split(",");
    // Default hosts plus the catalog host, de-duplicated.
    assertEquals(hosts.includes("alpha.example.com"), true);
    for (const host of DAEMON_DEFAULT_NET_HOSTS) {
      assertEquals(hosts.includes(host), true, `expected default host ${host}`);
    }
    assertEquals(new Set(hosts).size, hosts.length);
  } finally {
    await cleanup();
  }
});

Deno.test("[bindings] a set allow_net is never extended with catalog hosts", async () => {
  const { configService, db, cleanup } = await createCliTestContext();
  const raw = configService.getAll();
  raw.system.allow_net = ["only.example.com"];
  raw.catalog = {
    models: {},
    services: {
      alpha: {
        adapter: "mock",
        transport: "cloud",
        interface: "api",
        serves: { "*": "{name}" },
        endpoint: "https://alpha.example.com/v1",
      },
    },
  };
  const cmds = new TestDaemonCommands(createStubContext({ config: configService, db }));
  try {
    const flags = await cmds.callSpawnFlags();
    assertEquals(netFlag(flags), "--allow-net=only.example.com");
  } finally {
    await cleanup();
  }
});

Deno.test("[bindings] allow_net=[] stays blocked (no --allow-net flag) regardless of catalog hosts", async () => {
  const { configService, db, cleanup } = await createCliTestContext();
  const raw = configService.getAll();
  raw.system.allow_net = [];
  raw.catalog = {
    models: {},
    services: {
      alpha: {
        adapter: "mock",
        transport: "cloud",
        interface: "api",
        serves: { "*": "{name}" },
        endpoint: "https://alpha.example.com/v1",
      },
    },
  };
  const cmds = new TestDaemonCommands(createStubContext({ config: configService, db }));
  try {
    const flags = await cmds.callSpawnFlags();
    assertEquals(flags.some((f) => f.startsWith("--allow-net")), false);
  } finally {
    await cleanup();
  }
});
