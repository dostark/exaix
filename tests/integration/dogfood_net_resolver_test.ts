/**
 * @module DogfoodNetResolverTest
 * @path tests/integration/dogfood_net_resolver_test.ts
 * @description Phase 124 Step 8 (GAP-12) — verifies resolveDogfoodNetFlag validates
 *   the parsed `[system].allow_net` shape and falls back to the default host list
 *   on a malformed value (non-array / non-string entries) rather than trusting an
 *   unchecked cast.
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/path]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { resolveDogfoodNetFlag } from "../../scripts/dogfood_daemon.ts";

const DEFAULT_NET = "--allow-net=api.anthropic.com,api.openai.com,localhost:11434";

async function withConfig(body: string, fn: (path: string) => void): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "dogfood-net-" });
  const configPath = join(dir, "exa.config.toml");
  Deno.writeTextFileSync(configPath, body);
  try {
    fn(configPath);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("[dogfood_daemon] valid allow_net → narrowed --allow-net flag", async () => {
  await withConfig('[system]\nallow_net = ["api.anthropic.com"]\n', (p) => {
    assertEquals(resolveDogfoodNetFlag(p), "--allow-net=api.anthropic.com");
  });
});

Deno.test("[dogfood_daemon] empty allow_net → null (outbound blocked)", async () => {
  await withConfig("[system]\nallow_net = []\n", (p) => {
    assertEquals(resolveDogfoodNetFlag(p), null);
  });
});

Deno.test("[dogfood_daemon] omitted allow_net → default host list", async () => {
  await withConfig('[system]\nversion = "1.0.0"\n', (p) => {
    assertEquals(resolveDogfoodNetFlag(p), DEFAULT_NET);
  });
});

Deno.test("[dogfood_daemon] resolveDogfoodNetFlag falls back to default hosts on a malformed allow_net (GAP-12)", async () => {
  // allow_net is a string, not a string[] — a shape the bare cast would have
  // silently mis-typed. The resolver must validate and fall back.
  await withConfig('[system]\nallow_net = "not-an-array"\n', (p) => {
    assertEquals(resolveDogfoodNetFlag(p), DEFAULT_NET);
  });
});

Deno.test("[dogfood_daemon] resolveDogfoodNetFlag falls back when allow_net has non-string entries (GAP-12)", async () => {
  await withConfig("[system]\nallow_net = [123, 456]\n", (p) => {
    assertEquals(resolveDogfoodNetFlag(p), DEFAULT_NET);
  });
});
