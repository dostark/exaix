/**
 * @module TempDirTestHelper
 * @path packages/testing/src/helpers/temp_dir.ts
 * @description Runs a test body with a fresh temporary directory and removes the directory afterwards.
 * @architectural-layer Testing
 * @related-files [packages/testing/mod.ts]
 */

/** Creates a temporary directory, passes it to `body`, and removes it even when `body` throws. */
export async function withTempDir(
  body: (dir: string) => Promise<void> | void,
  options: Deno.MakeTempOptions = {},
): Promise<void> {
  const dir = await Deno.makeTempDir(options);
  try {
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
