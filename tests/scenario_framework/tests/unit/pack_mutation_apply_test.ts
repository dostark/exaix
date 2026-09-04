/**
 * @module PackMutationApplyTest
 * @path tests/scenario_framework/tests/unit/pack_mutation_apply_test.ts
 * @description Phase 142 Step 21 (GAP-5) — the mutation applier round-trips exactly.
 *
 *   `withMutation` edits real source files in the working tree. The property that makes that
 *   acceptable is that the file is byte-identical afterwards whatever happens inside — including
 *   when the pack run throws, which is the case that would otherwise leave a mutated tree behind
 *   and be mistaken for uncommitted work.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/pack_mutations.ts, scripts/verify_pack_mutations.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { type IPackMutation, withMutation } from "../../runner/pack_mutations.ts";

const FIXTURE_SOURCE = [
  "export class ToolRegistry {",
  "  resolve(name: string) {",
  "    return name;",
  "  }",
  "}",
  "",
].join("\n");

async function seedFixture(): Promise<{ root: string; file: string; cleanup: () => Promise<void> }> {
  const root = await Deno.makeTempDir({ prefix: "pack-mutation-" });
  const file = "src/tool_registry.ts";
  await Deno.mkdir(join(root, "src"), { recursive: true });
  await Deno.writeTextFile(join(root, file), FIXTURE_SOURCE);
  return { root, file, cleanup: () => Deno.remove(root, { recursive: true }) };
}

function mutationFor(file: string): IPackMutation {
  return {
    subsystem: "subsystem:tools",
    file,
    find: "export class ToolRegistry",
    replace: "export class ToolRegistry_MUTATED",
    breaks: "tool registration — nothing resolves, so every round-trip scenario fails",
  };
}

Deno.test("[mutation] applying a mutation changes the anchored bytes and reverting restores them exactly", async () => {
  const { root, file, cleanup } = await seedFixture();
  try {
    let observed = "";
    await withMutation(root, mutationFor(file), async () => {
      observed = await Deno.readTextFile(join(root, file));
    });

    assert(observed.includes("ToolRegistry_MUTATED"), "the tree must be mutated while the callback runs");
    assertEquals(
      await Deno.readTextFile(join(root, file)),
      FIXTURE_SOURCE,
      "the file must be byte-identical after the callback returns",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[mutation] a revert runs even when the pack run throws", async () => {
  const { root, file, cleanup } = await seedFixture();
  try {
    await assertRejects(
      () =>
        withMutation(root, mutationFor(file), () => {
          throw new Error("scenario run exploded");
        }),
      Error,
      "scenario run exploded",
    );

    assertEquals(
      await Deno.readTextFile(join(root, file)),
      FIXTURE_SOURCE,
      "an aborted run must still leave the tree clean",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("[mutation] a dangling anchor is refused before anything is written", async () => {
  const { root, file, cleanup } = await seedFixture();
  try {
    const stale: IPackMutation = { ...mutationFor(file), find: "export class GoneAwayRegistry" };
    await assertRejects(() => withMutation(root, stale, () => Promise.resolve()), Error, "no longer resolves");

    assertEquals(await Deno.readTextFile(join(root, file)), FIXTURE_SOURCE);
  } finally {
    await cleanup();
  }
});

Deno.test("[mutation] only the first occurrence is replaced, matching the coverage test's no-op check", async () => {
  const root = await Deno.makeTempDir({ prefix: "pack-mutation-" });
  const file = "repeated.ts";
  try {
    await Deno.writeTextFile(join(root, file), "agent_role_id\nagent_role_id\n");
    const mutation: IPackMutation = {
      subsystem: "subsystem:agent_roles",
      file,
      find: "agent_role_id",
      replace: "agent_role_id_MUTATED",
      breaks: "the agent role stamped onto a written plan, which the smokes assert per-scenario",
    };

    let observed = "";
    await withMutation(root, mutation, async () => {
      observed = await Deno.readTextFile(join(root, file));
    });

    assertEquals(observed, "agent_role_id_MUTATED\nagent_role_id\n");
    assertEquals(await Deno.readTextFile(join(root, file)), "agent_role_id\nagent_role_id\n");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
