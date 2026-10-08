/**
 * @module Ste100AssetsFixture
 * @path tests/scenario_framework/tests/unit/helpers/ste100_assets_fixture.ts
 * @description Shared temp-root scaffolding for the ste100 asset baseline and isolated-output tests.
 * @architectural-layer Testing
 * @related-files [tests/scenario_framework/tests/unit/ste100_assets_test.ts, tests/scenario_framework/tests/unit/ste100_assets_security_test.ts]
 */

export async function withTempRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "ste100-assets-" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}
