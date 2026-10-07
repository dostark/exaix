/**
 * @module ConfigServiceGenerationTest
 * @path packages/core/tests/config/config_service_generation_test.ts
 * @description The config checksum names the last valid config generation. A reload that fails
 *   validation keeps both the previous config and the previous checksum, and a later valid edit
 *   moves to a new generation.
 * @architectural-layer Core
 * @dependencies [@std/assert, @exaix/core/config]
 * @related-files [packages/core/src/config/service.ts]
 */

import { assert, assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ConfigService } from "@exaix/core/config";

const VALID = '[system]\nroot = "."\nversion = "1.0.0"\nlog_level = "info"\n';

Deno.test("[config generation] a failed reload keeps the last valid config and checksum", async () => {
  const dir = await Deno.makeTempDir({ prefix: "config-generation-" });
  try {
    const path = join(dir, "exa.config.toml");
    await Deno.writeTextFile(path, VALID);
    const service = new ConfigService(path);
    const firstChecksum = service.getChecksum();
    const firstMax = service.get().skills.max_per_request;

    await Deno.writeTextFile(path, `${VALID}\n[skills]\nmax_per_request = "not a number"\n`);
    assertThrows(() => service.reload());
    assertEquals(service.getChecksum(), firstChecksum);
    assertEquals(service.get().skills.max_per_request, firstMax);

    await Deno.writeTextFile(path, `${VALID}\n[skills]\nmax_per_request = 2\n`);
    service.reload();
    assertNotEquals(service.getChecksum(), firstChecksum);
    assertEquals(service.get().skills.max_per_request, 2);
    assert(service.getChecksum().length > 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
