/**
 * @module WorkspacePathsTest
 * @path tests/compat/workspace_paths_test.ts
 * @description Verifies that the harness validates every workspace copy path through PathResolver.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createCopyResolver, mapToCopy } from "./harness/workspace_paths.ts";
import { SANDBOX_COPY_ROOT } from "./harness/sandbox.ts";

const PORTAL_ALIAS = "app";
const PORTAL_DIR = "portals-src/app";

const CONFIG_FIXTURE = "tests/fixtures/compat/copy_config.toml";

async function makeCopy(): Promise<string> {
  const configText = await Deno.readTextFile(CONFIG_FIXTURE);
  const dir = await Deno.makeTempDir({ prefix: "compat-paths-" });
  await Deno.writeTextFile(join(dir, "exa.config.toml"), configText);
  await Deno.mkdir(join(dir, "Workspace", "Active"), { recursive: true });
  await Deno.mkdir(join(dir, "Memory"), { recursive: true });
  await Deno.mkdir(join(dir, PORTAL_DIR), { recursive: true });
  return dir;
}

Deno.test("workspace paths: system.root and portal target paths are mapped to the copy in memory", async () => {
  const dir = await makeCopy();
  try {
    const resolver = await createCopyResolver(dir);

    assertEquals(await resolver.resolve("@Workspace/Active"), join(dir, "Workspace", "Active"));
    assertEquals(await resolver.resolve(`@${PORTAL_ALIAS}/src`), join(dir, PORTAL_DIR, "src"));
    assertEquals(mapToCopy(`${SANDBOX_COPY_ROOT}/Workspace`, dir), join(dir, "Workspace"));
    assertEquals(mapToCopy(SANDBOX_COPY_ROOT, dir), dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workspace paths: exa.config.toml is unchanged after createCopyResolver", async () => {
  const dir = await makeCopy();
  try {
    await createCopyResolver(dir);

    assertEquals(await Deno.readTextFile(join(dir, "exa.config.toml")), await Deno.readTextFile(CONFIG_FIXTURE));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workspace paths: an @Workspace path escaping the copy is denied by PathResolver", async () => {
  const dir = await makeCopy();
  const outside = await Deno.makeTempDir({ prefix: "compat-outside-" });
  try {
    await Deno.symlink(outside, join(dir, "Workspace", "Active", "escape"));
    const resolver = await createCopyResolver(dir);

    await assertRejects(() => resolver.resolve("@Workspace/Active/escape/file.md"), Error, "Access denied");
    await assertRejects(() => resolver.resolve("@Workspace/../../outside"), Error, "Access denied");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("workspace paths: the resolver writes no journal row", async () => {
  const dir = await makeCopy();
  try {
    const resolver = await createCopyResolver(dir);
    await resolver.resolve("@Workspace/Active");

    const entries: string[] = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry.name);
    assertEquals(entries.sort(), ["Memory", "Workspace", "exa.config.toml", "portals-src"].sort());
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
