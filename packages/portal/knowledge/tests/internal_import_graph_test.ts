/**
 * @module InternalImportGraphBuilderTest
 * @path packages/portal/knowledge/tests/internal_import_graph_test.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Tests for InternalImportGraphBuilder (Phase 175 Step 1): resolves
 * relative-import edges between portal files via `deno info --json`, dropping any
 * specifier that resolves outside the portal root. Uses real temporary directories
 * and a real `deno info` subprocess call to exercise actual resolution behaviour.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { InternalImportGraphBuilder } from "../internal_import_graph.ts";

async function makeTempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "exa_internal_import_graph_test_" });
}

async function writeFile(dir: string, relPath: string, content: string): Promise<void> {
  const full = join(dir, relPath);
  const lastSlash = full.lastIndexOf("/");
  if (lastSlash !== -1) {
    await Deno.mkdir(full.substring(0, lastSlash), { recursive: true });
  }
  await Deno.writeTextFile(full, content);
}

async function withPortalFixture(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await makeTempDir();
  try {
    for (const [path, content] of Object.entries(files)) {
      await writeFile(root, path, content);
    }
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("InternalImportGraphBuilder: returns empty edges for empty entrypoints", async () => {
  const builder = new InternalImportGraphBuilder();

  const result = await builder.build("/tmp", []);

  assertEquals(result, { edges: [], droppedOutOfBounds: [], truncatedEntrypointCount: 0 });
});

Deno.test("InternalImportGraphBuilder: resolves a relative import into an internal edge", async () => {
  await withPortalFixture(
    {
      "main.ts": `import { util } from "./util.ts";\nutil();\n`,
      "util.ts": `export function util() {}\n`,
    },
    async (root) => {
      const builder = new InternalImportGraphBuilder();
      const result = await builder.build(root, ["main.ts"]);

      assertEquals(result.edges, [
        { from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" },
      ]);
      assertEquals(result.droppedOutOfBounds, []);
    },
  );
});

Deno.test("InternalImportGraphBuilder: does not include bare/external specifiers as edges", async () => {
  await withPortalFixture(
    {
      "main.ts": `import { join } from "jsr:@std/path";\nimport { util } from "./util.ts";\njoin(); util();\n`,
      "util.ts": `export function util() {}\n`,
    },
    async (root) => {
      const builder = new InternalImportGraphBuilder();
      const result = await builder.build(root, ["main.ts"]);

      assertEquals(result.edges, [
        { from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" },
      ]);
    },
  );
});

Deno.test("InternalImportGraphBuilder: drops a specifier resolving outside the portal root", async () => {
  const parent = await Deno.makeTempDir({ prefix: "exa_internal_import_graph_test_parent_" });
  try {
    const outsideFile = join(parent, "outside.ts");
    await Deno.writeTextFile(outsideFile, `export function outside() {}\n`);

    const root = join(parent, "portal");
    await Deno.mkdir(root, { recursive: true });
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { outside } from "../outside.ts";\noutside();\n`,
    );

    const builder = new InternalImportGraphBuilder();
    const result = await builder.build(root, ["main.ts"]);

    assertEquals(result.edges, []);
    assertEquals(result.droppedOutOfBounds.length, 1);
    assertEquals(result.droppedOutOfBounds[0].from, "main.ts");
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("InternalImportGraphBuilder: handles missing directory gracefully", async () => {
  const builder = new InternalImportGraphBuilder();

  const result = await builder.build("/nonexistent/portal/path", ["main.ts"]);

  assertEquals(result, { edges: [], droppedOutOfBounds: [], truncatedEntrypointCount: 0 });
});

Deno.test("InternalImportGraphBuilder: handles a nonexistent entrypoint gracefully", async () => {
  await withPortalFixture({}, async (root) => {
    const builder = new InternalImportGraphBuilder();
    const result = await builder.build(root, ["nonexistent.ts"]);

    assertEquals(result, { edges: [], droppedOutOfBounds: [], truncatedEntrypointCount: 0 });
  });
});

Deno.test("InternalImportGraphBuilder: captures edges from an entrypoint beyond the historical 5-entrypoint position", async () => {
  const files: Record<string, string> = {};
  for (let i = 1; i <= 7; i++) {
    files[`pkg${i}/mod.ts`] = `import { util } from "./util.ts";\nutil();\n`;
    files[`pkg${i}/util.ts`] = `export function util() {}\n`;
  }

  await withPortalFixture(files, async (root) => {
    const builder = new InternalImportGraphBuilder();
    const entrypoints = [1, 2, 3, 4, 5, 6, 7].map((i) => `pkg${i}/mod.ts`);
    const result = await builder.build(root, entrypoints);

    for (const i of [6, 7]) {
      assertEquals(
        result.edges.some((e) => e.from === `pkg${i}/mod.ts` && e.to === `pkg${i}/util.ts`),
        true,
        `expected an edge from pkg${i}/mod.ts, which is beyond the historical 5-entrypoint cap`,
      );
    }
    assertEquals(result.edges.length, 7);
  });
});

Deno.test("InternalImportGraphBuilder: truncates and reports when entrypoints exceed an injected limit", async () => {
  const files: Record<string, string> = {};
  for (let i = 1; i <= 3; i++) {
    files[`pkg${i}/mod.ts`] = `import { util } from "./util.ts";\nutil();\n`;
    files[`pkg${i}/util.ts`] = `export function util() {}\n`;
  }

  await withPortalFixture(files, async (root) => {
    const builder = new InternalImportGraphBuilder(2);
    const entrypoints = [1, 2, 3].map((i) => `pkg${i}/mod.ts`);
    const result = await builder.build(root, entrypoints);

    assertEquals(result.edges.length, 2);
    assertEquals(result.truncatedEntrypointCount, 1);
  });
});

Deno.test("InternalImportGraphBuilder: captures an edge for a relative import statement that uses 'import type'", async () => {
  await withPortalFixture(
    {
      "main.ts": `import type { Config } from "./config.ts";\nexport function use(c: Config): void {}\n`,
      "config.ts": `export interface Config { name: string }\n`,
    },
    async (root) => {
      const builder = new InternalImportGraphBuilder();
      const result = await builder.build(root, ["main.ts"]);

      assertEquals(result.edges, [
        { from: "main.ts", to: "config.ts", kind: "file_imports_file_internal" },
      ]);
      assertEquals(result.droppedOutOfBounds, []);
    },
  );
});

Deno.test("InternalImportGraphBuilder: does not produce a duplicate edge for a mixed value+type import of the same specifier", async () => {
  await withPortalFixture(
    {
      "main.ts": `import { util, type Config } from "./util.ts";\nutil();\n`,
      "util.ts": `export function util() {}\nexport interface Config { name: string }\n`,
    },
    async (root) => {
      const builder = new InternalImportGraphBuilder();
      const result = await builder.build(root, ["main.ts"]);

      assertEquals(result.edges, [
        { from: "main.ts", to: "util.ts", kind: "file_imports_file_internal" },
      ]);
    },
  );
});

Deno.test("InternalImportGraphBuilder: resolves edges when portalPath is a symlink to the real directory (the standard portal-mount shape)", async () => {
  await withPortalFixture({
    "mod.ts": "import { helper } from './services/helper.ts';\nexport function start(): void { helper(); }\n",
    "services/helper.ts": "export function helper(): void {}\n",
  }, async (root) => {
    const parent = await makeTempDir();
    try {
      const symlinkPath = join(parent, "Portals-alias");
      await Deno.symlink(root, symlinkPath, { type: "dir" });

      const builder = new InternalImportGraphBuilder();
      const result = await builder.build(symlinkPath, ["mod.ts"]);

      assertEquals(result.edges, [{ from: "mod.ts", to: "services/helper.ts", kind: "file_imports_file_internal" }]);
      assertEquals(result.droppedOutOfBounds, []);
    } finally {
      await Deno.remove(parent, { recursive: true });
    }
  });
});
