/**
 * @module FixtureTest
 * @path tests/compat/fixture_test.ts
 * @description Verifies the pending-review fixture builders and the committed fixture archive.
 */

import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertNotMatch,
  assertStringIncludes,
} from "@std/assert";
import { Database } from "@db/sqlite";
import { join } from "@std/path";
import { COMPAT_FIXTURE_MAX_BYTES } from "./harness/compat_constants.ts";
import {
  createArchive,
  findLeaks,
  FIXTURE_ARCHIVE_PATH,
  FIXTURE_MANIFEST_PATH,
  FIXTURE_PLANS,
  FixtureReviewKind,
  renderPlan,
  sha256File,
} from "./harness/fixture.ts";
import type { IFixtureManifest } from "./harness/fixture.ts";

const REQUEST_PREFIX_LENGTH = 8;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const JOURNAL_RELATIVE_PATH = ".exa/journal.db";

async function extractCommittedArchive(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "compat-fixture-" });
  const output = await new Deno.Command("tar", { args: ["-xf", FIXTURE_ARCHIVE_PATH, "-C", dir] }).output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return dir;
}

async function loadManifest(): Promise<IFixtureManifest> {
  return JSON.parse(await Deno.readTextFile(FIXTURE_MANIFEST_PATH));
}

Deno.test("fixture: a plan with a write action renders its frontmatter and a TOML block", () => {
  const plan = FIXTURE_PLANS.find((candidate) => candidate.write !== null);
  assert(plan !== undefined && plan.write !== null, "no write plan");
  const text = renderPlan(plan);

  assertStringIncludes(text, `trace_id: "${plan.traceId}"`);
  assertStringIncludes(text, `request_id: "${plan.requestId}"`);
  assertStringIncludes(text, "status: approved");
  assertStringIncludes(text, 'tool = "write_file"');
  assertStringIncludes(text, `path = "${plan.write.path}"`);
});

Deno.test("fixture: a read-only plan has no tool block and every plan has a distinct request id", () => {
  const readOnly = FIXTURE_PLANS.find((candidate) => candidate.write === null);
  assert(readOnly !== undefined, "no read-only plan");
  assertNotMatch(renderPlan(readOnly), /tool =/);

  const requestIds = FIXTURE_PLANS.map((plan) => plan.requestId);
  assertEquals(new Set(requestIds).size, requestIds.length);
  const traceIds = FIXTURE_PLANS.map((plan) => plan.traceId);
  assertEquals(new Set(traceIds).size, traceIds.length);
  for (const plan of FIXTURE_PLANS) {
    assertEquals(plan.traceId.slice(0, REQUEST_PREFIX_LENGTH), plan.requestId.replace("request-", ""));
  }
});

Deno.test("fixture: the leak scan reports a host path and an API key and passes a clean tree", async () => {
  const dir = await Deno.makeTempDir({ prefix: "compat-leak-" });
  try {
    await Deno.writeTextFile(join(dir, "clean.txt"), "nothing to see");
    assertEquals(await findLeaks(dir, ["/home/someone"]), []);

    await Deno.mkdir(join(dir, "nested"));
    await Deno.writeTextFile(join(dir, "nested", "path.txt"), "root=/home/someone/project");
    await Deno.writeTextFile(join(dir, "key.txt"), "GOOGLE_API_KEY=abcdef123456");

    const leaks = (await findLeaks(dir, ["/home/someone"])).map((leak) => leak.file).sort();
    assertEquals(leaks, ["key.txt", join("nested", "path.txt")]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fixture: an archive records its size and hash and holds the tree", async () => {
  const dir = await Deno.makeTempDir({ prefix: "compat-archive-" });
  try {
    await Deno.mkdir(join(dir, "tree"));
    await Deno.writeTextFile(join(dir, "tree", "a.txt"), "alpha");
    const archive = join(dir, "out.tar");
    const info = await createArchive(join(dir, "tree"), archive);

    assertEquals(info.bytes, (await Deno.stat(archive)).size);
    assertEquals(info.sha256, await sha256File(archive));
    assertMatch(info.sha256, SHA256_PATTERN);
    const listing = await new Deno.Command("tar", { args: ["-tf", archive] }).output();
    assertStringIncludes(new TextDecoder().decode(listing.stdout), "a.txt");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fixture: the manifest hash matches the archive", async () => {
  const manifest = await loadManifest();

  assertMatch(manifest.archiveSha256, SHA256_PATTERN);
  assertEquals(await sha256File(FIXTURE_ARCHIVE_PATH), manifest.archiveSha256);
  assertEquals((await Deno.stat(FIXTURE_ARCHIVE_PATH)).size, manifest.archiveBytes);
  assertNotEquals(manifest.binding, "");
});

Deno.test("fixture: every manifest review exists in the archive's database or Git refs", async () => {
  const manifest = await loadManifest();
  const dir = await extractCommittedArchive();
  try {
    const database = new Database(join(dir, JOURNAL_RELATIVE_PATH), { readonly: true });
    try {
      assert(manifest.reviews.length > 0, "the manifest lists no review");
      for (const review of manifest.reviews) {
        assert(review.provenance.length > 0, `review ${review.reviewRef} has no provenance`);
        if (review.kind === FixtureReviewKind.ARTIFACT) {
          const row = database.prepare("SELECT status FROM artifacts WHERE id = ?").get(review.reviewRef);
          assertEquals(row?.status, "pending");
        } else {
          const row = database.prepare("SELECT branch, status FROM reviews WHERE trace_id = ?").get(review.traceId);
          assertEquals(row?.status, "pending");
          assertEquals(row?.branch, review.branch);
          const refs = await new Deno.Command("git", {
            args: ["-C", join(dir, "portals-src", review.portal), "for-each-ref", `refs/heads/${review.branch}`],
          }).output();
          assertStringIncludes(new TextDecoder().decode(refs.stdout), `refs/heads/${review.branch}`);
        }
      }
    } finally {
      database.close();
    }
    const kinds = manifest.reviews.map((review) => review.kind);
    const required = Object.values(FixtureReviewKind).filter((kind) => kind !== FixtureReviewKind.ARTIFACT);
    for (const kind of required) assertArrayIncludes(kinds, [kind], `no ${kind} review`);
    if (!kinds.includes(FixtureReviewKind.ARTIFACT)) {
      assertEquals(manifest.artifactProbe.status, "no-recipe", "the artifact review is missing without a probe result");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fixture: the archive contains no host path or credential", async () => {
  const dir = await extractCommittedArchive();
  try {
    const needles = [Deno.env.get("HOME") ?? "/nonexistent-home", "exaix-sandboxes"];
    assertEquals(await findLeaks(dir, needles), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fixture: the archive is under the size cap", async () => {
  const manifest = await loadManifest();

  assert(manifest.archiveBytes <= COMPAT_FIXTURE_MAX_BYTES, `${manifest.archiveBytes} bytes exceed the cap`);
  assert(manifest.archiveBytes > 0);
});
