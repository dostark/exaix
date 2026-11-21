/**
 * @module GoAgentsdocGatesTest
 * @path tests/scripts/go_agentsdoc_gates_test.ts
 * @description Exercises the Go agent-documentation checker in standalone and parent modes.
 * @architectural-layer Test
 */
import { assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { checkout, copy, GO, GO_PATH, run } from "./helpers/go_checkout_fixture.ts";

function check(repo: string, parent?: string): Promise<{ code: number; text: string }> {
  const args = ["run", "./tools/agentsdoc"];
  if (parent) args.push("-parent", parent);
  return run(repo, GO, args, { PATH: GO_PATH });
}

Deno.test("go-agentsdoc: both layouts pass", { ignore: checkout === undefined }, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const standalone = await check(repo);
    assertEquals(standalone.code, 0, standalone.text);
    assertStringIncludes(standalone.text, "agentsdoc: ok");
    const parent = join(dir, "parent");
    await Deno.mkdir(join(parent, "exaix-dev-docs", "planning"), { recursive: true });
    const linked = await check(repo, parent);
    assertEquals(linked.code, 0, linked.text);
    assertStringIncludes(linked.text, "agentsdoc: ok");
  });
});

const seeds = [
  {
    name: "broken link",
    marker: "missing.md",
    apply: async (repo: string) => {
      const path = join(repo, "AGENTS.md");
      await Deno.writeTextFile(path, `${await Deno.readTextFile(path)}\n[missing](missing.md)\n`);
    },
  },
  {
    name: "missing skill",
    marker: "missing skill: commit",
    apply: async (repo: string) => {
      await Deno.remove(join(repo, ".agents", "skills", "commit", "SKILL.md"));
    },
  },
  {
    name: "invalid frontmatter",
    marker: "missing description",
    apply: async (repo: string) => {
      const path = join(repo, ".agents", "skills", "go-development", "SKILL.md");
      const text = await Deno.readTextFile(path);
      await Deno.writeTextFile(path, text.replace(/^description:.*$/m, "note: no description"));
    },
  },
  {
    name: "wrong alias",
    marker: ".claude must resolve to .agents",
    apply: async (repo: string) => {
      await Deno.remove(join(repo, ".claude"));
      await Deno.writeTextFile(join(repo, ".claude"), "not a link\n");
    },
  },
];

for (const seed of seeds) {
  Deno.test(`go-agentsdoc: rejects ${seed.name}`, { ignore: checkout === undefined }, async () => {
    await withTempDir(async (dir) => {
      const repo = await copy(dir);
      await seed.apply(repo);
      const result = await check(repo);
      assertNotEquals(result.code, 0);
      assertStringIncludes(result.text, seed.marker);
    });
  });
}

Deno.test("go-agentsdoc: a parent reference resolves only in parent mode", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const parent = join(dir, "parent");
    await Deno.mkdir(parent, { recursive: true });
    const missing = await check(repo, parent);
    assertNotEquals(missing.code, 0);
    assertStringIncludes(missing.text, "external link missing from parent");
    await Deno.mkdir(join(parent, "exaix-dev-docs", "planning"), { recursive: true });
    const resolved = await check(repo, parent);
    assertEquals(resolved.code, 0, resolved.text);
  });
});
