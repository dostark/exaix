/**
 * @module SkillFolderPublisherTest
 * @path packages/core/tests/skills/skill_folder_publisher_test.ts
 * @description Phase 206 Step 3 — guarded publication of skill folders: no-clobber create,
 *   backup-protected replace and remove, exclusive locking across concurrent writers,
 *   crash recovery from every interrupted state, and rejection of symlinked state.
 * @architectural-layer Core
 * @dependencies [@std/assert, @std/path, @exaix/core/skills, @exaix/tool-runtime]
 * @related-files [packages/core/src/skills/skill_folder_publisher.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createPathSecurity } from "@exaix/tool-runtime";
import { SkillMutationErrorCode } from "@exaix/core";
import {
  computeSkillContentSha256,
  type ISkillRevisionSnapshot,
  SkillFolderPublisher,
  SkillMutationError,
} from "@exaix/core/skills";

function snap(body: string): ISkillRevisionSnapshot {
  return {
    skill_md: `---\nname: pub-skill\ndescription: Publisher test skill\n---\n${body}\n`,
    exaix_yaml: "status: draft\n",
    references: [],
  };
}

async function withRoot(fn: (root: string, publisher: SkillFolderPublisher) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "exa-skill-pub-" });
  const publisher = new SkillFolderPublisher(createPathSecurity(), 500);
  try {
    await publisher.ensureState(root);
    await fn(root, publisher);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function bodyOf(root: string): Promise<string> {
  return await Deno.readTextFile(join(root, "pub-skill", "SKILL.md"));
}

async function stateEntries(root: string, kind: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(join(root, ".exa-skill-state", kind))) out.push(entry.name);
  return out;
}

Deno.test("[publisher] create publishes a complete folder and leaves no intent, staging or backup", async () => {
  await withRoot(async (root, publisher) => {
    await publisher.create(root, "pub-skill", snap("one"));
    assertEquals((await bodyOf(root)).includes("one"), true);
    assertEquals(await Deno.readTextFile(join(root, "pub-skill", "exaix.yaml")), "status: draft\n");
    for (const kind of ["intents", "staging", "backup"]) assertEquals(await stateEntries(root, kind), []);
  });
});

Deno.test("[publisher] create never clobbers an existing folder", async () => {
  await withRoot(async (root, publisher) => {
    await publisher.create(root, "pub-skill", snap("one"));
    const error = await assertRejects(() => publisher.create(root, "pub-skill", snap("two")), SkillMutationError);
    assertEquals(error.code, SkillMutationErrorCode.NAME_CONFLICT);
    assertEquals((await bodyOf(root)).includes("one"), true);
  });
});

Deno.test("[publisher] replace swaps content and removes the backup", async () => {
  await withRoot(async (root, publisher) => {
    await publisher.create(root, "pub-skill", snap("one"));
    await publisher.replace(root, "pub-skill", snap("two"));
    assertEquals((await bodyOf(root)).includes("two"), true);
    assertEquals(await stateEntries(root, "backup"), []);
  });
});

Deno.test("[publisher] replace and remove report a missing folder as not found", async () => {
  await withRoot(async (root, publisher) => {
    const replaced = await assertRejects(() => publisher.replace(root, "pub-skill", snap("x")), SkillMutationError);
    assertEquals(replaced.code, SkillMutationErrorCode.NOT_FOUND);
    const removed = await assertRejects(() => publisher.remove(root, "pub-skill"), SkillMutationError);
    assertEquals(removed.code, SkillMutationErrorCode.NOT_FOUND);
  });
});

Deno.test("[publisher] remove deletes the whole folder", async () => {
  await withRoot(async (root, publisher) => {
    await publisher.create(root, "pub-skill", snap("one"));
    await publisher.remove(root, "pub-skill");
    assertEquals(await Deno.lstat(join(root, "pub-skill")).catch(() => null), null);
    assertEquals(await stateEntries(root, "backup"), []);
  });
});

Deno.test("[publisher] concurrent creates of one name under the lock yield exactly one winner", async () => {
  await withRoot(async (root, publisher) => {
    const attempt = (body: string) =>
      publisher.withLocks([root], "exclusive", () => publisher.create(root, "pub-skill", snap(body)));
    const results = await Promise.allSettled([attempt("a"), attempt("b"), attempt("c")]);
    assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
    assertEquals(results.filter((r) => r.status === "rejected").length, 2);
  });
});

Deno.test("[publisher] an exclusive lock holder blocks a second locker until the timeout", async () => {
  await withRoot(async (root, publisher) => {
    await publisher.withLocks([root], "exclusive", async () => {
      const other = new SkillFolderPublisher(createPathSecurity(), 150);
      const error = await assertRejects(
        () => other.withLocks([root], "exclusive", () => Promise.resolve()),
        SkillMutationError,
      );
      assertEquals(error.code, SkillMutationErrorCode.PUBLICATION_UNAVAILABLE);
    });
  });
});

interface IPlantedIntent {
  operation: string;
  name: string;
  destination: string;
  staging: string | null;
  backup: string | null;
  intended_sha256: string | null;
}

/** Writes an intent file the way a crashed publisher would have left it. */
async function plantIntent(root: string, intent: IPlantedIntent): Promise<void> {
  await Deno.writeTextFile(
    join(root, ".exa-skill-state", "intents", `${crypto.randomUUID()}.json`),
    JSON.stringify(intent),
  );
}

Deno.test("[recovery] a create interrupted before the rename removes the staged folder and leaves no destination", async () => {
  await withRoot(async (root, publisher) => {
    const staging = join(root, ".exa-skill-state", "staging", "op-1");
    await Deno.mkdir(staging, { recursive: true });
    await Deno.writeTextFile(join(staging, "SKILL.md"), snap("one").skill_md);
    await plantIntent(root, {
      operation: "create",
      name: "pub-skill",
      destination: join(root, "pub-skill"),
      staging,
      backup: null,
      intended_sha256: await computeSkillContentSha256(snap("one")),
    });
    assertEquals(await publisher.recover(root), 1);
    assertEquals(await Deno.lstat(join(root, "pub-skill")).catch(() => null), null);
    assertEquals(await stateEntries(root, "staging"), []);
    assertEquals(await stateEntries(root, "intents"), []);
  });
});

Deno.test("[recovery] a create interrupted after the rename keeps the verified destination", async () => {
  await withRoot(async (root, publisher) => {
    await publisher.create(root, "pub-skill", snap("one"));
    await plantIntent(root, {
      operation: "create",
      name: "pub-skill",
      destination: join(root, "pub-skill"),
      staging: join(root, ".exa-skill-state", "staging", "gone"),
      backup: null,
      intended_sha256: await computeSkillContentSha256(snap("one")),
    });
    assertEquals(await publisher.recover(root), 1);
    assertEquals((await bodyOf(root)).includes("one"), true);
  });
});

Deno.test("[recovery] an update interrupted between the two renames restores the verified backup", async () => {
  await withRoot(async (root, publisher) => {
    await publisher.create(root, "pub-skill", snap("old"));
    const backup = join(root, ".exa-skill-state", "backup", "op-2");
    await Deno.rename(join(root, "pub-skill"), backup);
    const staging = join(root, ".exa-skill-state", "staging", "op-2");
    await Deno.mkdir(staging, { recursive: true });
    await Deno.writeTextFile(join(staging, "SKILL.md"), "partial");
    await plantIntent(root, {
      operation: "update",
      name: "pub-skill",
      destination: join(root, "pub-skill"),
      staging,
      backup,
      intended_sha256: await computeSkillContentSha256(snap("new")),
    });
    assertEquals(await publisher.recover(root), 1);
    assertEquals((await bodyOf(root)).includes("old"), true);
    assertEquals(await stateEntries(root, "backup"), []);
    assertEquals(await stateEntries(root, "staging"), []);
  });
});

Deno.test("[recovery] an update interrupted after the second rename keeps the intended revision and drops the backup", async () => {
  await withRoot(async (root, publisher) => {
    await publisher.create(root, "pub-skill", snap("old"));
    const backup = join(root, ".exa-skill-state", "backup", "op-3");
    await Deno.rename(join(root, "pub-skill"), backup);
    await publisher.create(root, "pub-skill", snap("new"));
    await plantIntent(root, {
      operation: "update",
      name: "pub-skill",
      destination: join(root, "pub-skill"),
      staging: null,
      backup,
      intended_sha256: await computeSkillContentSha256(snap("new")),
    });
    assertEquals(await publisher.recover(root), 1);
    assertEquals((await bodyOf(root)).includes("new"), true);
    assertEquals(await stateEntries(root, "backup"), []);
  });
});

Deno.test("[recovery] a delete interrupted after the rename completes the delete", async () => {
  await withRoot(async (root, publisher) => {
    await publisher.create(root, "pub-skill", snap("one"));
    const backup = join(root, ".exa-skill-state", "backup", "op-4");
    await Deno.rename(join(root, "pub-skill"), backup);
    await plantIntent(root, {
      operation: "delete",
      name: "pub-skill",
      destination: join(root, "pub-skill"),
      staging: null,
      backup,
      intended_sha256: null,
    });
    assertEquals(await publisher.recover(root), 1);
    assertEquals(await Deno.lstat(join(root, "pub-skill")).catch(() => null), null);
    assertEquals(await stateEntries(root, "backup"), []);
  });
});

Deno.test("[security] a symlinked state directory or lock file is refused", async () => {
  const base = await Deno.makeTempDir({ prefix: "exa-skill-pub-sec-" });
  const publisher = new SkillFolderPublisher(createPathSecurity(), 500);
  try {
    await Deno.mkdir(join(base, "root"));
    await Deno.mkdir(join(base, "elsewhere"));
    await Deno.symlink(join(base, "elsewhere"), join(base, "root", ".exa-skill-state"));
    const error = await assertRejects(() => publisher.ensureState(join(base, "root")), SkillMutationError);
    assertEquals(error.code, SkillMutationErrorCode.PUBLICATION_UNAVAILABLE);

    await Deno.mkdir(join(base, "root2", ".exa-skill-state"), { recursive: true });
    await Deno.writeTextFile(join(base, "target-lock"), "");
    await Deno.symlink(join(base, "target-lock"), join(base, "root2", ".exa-skill-state", "lock"));
    await assertRejects(() => publisher.ensureState(join(base, "root2")), SkillMutationError);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("[security] replace and remove refuse a folder that was swapped for a symlink", async () => {
  await withRoot(async (root, publisher) => {
    const outside = await Deno.makeTempDir({ prefix: "exa-skill-pub-out-" });
    try {
      await Deno.symlink(outside, join(root, "pub-skill"));
      const replaced = await assertRejects(() => publisher.replace(root, "pub-skill", snap("x")), SkillMutationError);
      assertEquals(replaced.code === SkillMutationErrorCode.ROOT_UNAVAILABLE, true);
      await assertRejects(() => publisher.remove(root, "pub-skill"), SkillMutationError);
      assertEquals((await Deno.lstat(outside)).isDirectory, true);
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});
