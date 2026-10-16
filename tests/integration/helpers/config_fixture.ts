/**
 * @module ConfigFixture
 * @path tests/integration/helpers/config_fixture.ts
 * @description Reads a workspace config from `tests/integration/fixtures/configs` and binds its
 *   placeholders. A test that needs a config reads a fixture instead of embedding TOML inline.
 * @architectural-layer Test
 * @related-files [tests/integration/fixtures/configs]
 */

/** Reads `fixtures/configs/<name>.toml` and replaces each `__KEY__` with its value. */
export function readConfigFixture(name: string, values: Record<string, string> = {}): string {
  const url = new URL(`../fixtures/configs/${name}.toml`, import.meta.url);
  const text = Deno.readTextFileSync(url);
  return Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`__${key.toUpperCase()}__`, value),
    text,
  );
}
