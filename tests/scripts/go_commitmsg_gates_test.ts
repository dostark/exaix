/**
 * @module GoCommitmsgGatesTest
 * @path tests/scripts/go_commitmsg_gates_test.ts
 * @description Exercises the commit-msg hook and the range validator.
 * @architectural-layer Test
 */
import { assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { goCheckout } from "../../scripts/go_port/checkout.ts";
import { commitBase, copyCheckout, git, GO, GO_PATH, make, run } from "./helpers/go_checkout_fixture.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const checkout = await goCheckout(ROOT, Deno.env.get("EXAIX_REQUIRE_GO") === "1");

const VALID = `feat(tooling): add the commit validator

what: Add the tooling commit validator and its tests.
rationale: Keep local and hosted messages consistent.
tests: The validator unit tests passed.
who: Fixture
impact: tooling: validate commit messages
`;

const MISSING_WHAT = `feat(tooling): add the commit validator

rationale: Keep local and hosted messages consistent.
tests: The validator unit tests passed.
who: Fixture
impact: tooling: validate commit messages
`;

const MISMATCHED = `feat(tooling): add the commit validator

what: Add the tooling commit validator and its tests.
rationale: Keep local and hosted messages consistent.
tests: The validator unit tests passed.
who: Fixture
impact: runtime: validate commit messages
`;

function copy(dir: string): Promise<string> {
  if (!checkout) throw new Error("The Go checkout is required for this case");
  return copyCheckout(checkout, dir);
}

async function commitWith(repo: string, name: string, message: string): Promise<{ code: number; text: string }> {
  await Deno.writeTextFile(join(repo, name), `${name}\n`);
  assertEquals((await git(repo, "add", name)).code, 0);
  const path = join(repo, `message-${name}.txt`);
  await Deno.writeTextFile(path, message);
  return await git(repo, "commit", "-F", path);
}

Deno.test("go-commitmsg-hook: the installed hook rejects and accepts structured messages", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    await commitBase(repo);
    assertEquals((await make(repo, "hooks")).code, 0);
    const missing = await commitWith(repo, "missing.txt", MISSING_WHAT);
    assertNotEquals(missing.code, 0);
    assertStringIncludes(missing.text, "missing what:");
    const mismatched = await commitWith(repo, "mismatched.txt", MISMATCHED);
    assertNotEquals(mismatched.code, 0);
    assertStringIncludes(mismatched.text, "missing from the what field");
    const accepted = await commitWith(repo, "accepted.txt", VALID);
    assertEquals(accepted.code, 0, accepted.text);
  });
});

Deno.test("go-commitmsg-range: an earlier invalid commit is not hidden by a valid final one", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    await commitBase(repo);
    const baseResult = await git(repo, "rev-parse", "HEAD");
    const base = baseResult.text.trim();
    const invalid = await commitWith(repo, "invalid.txt", MISSING_WHAT);
    assertEquals(invalid.code, 0, invalid.text);
    const invalidSha = (await git(repo, "rev-parse", "HEAD")).text.trim();
    const accepted = await commitWith(repo, "second.txt", VALID);
    assertEquals(accepted.code, 0, accepted.text);
    const result = await run(repo, GO, ["run", "./tools/commitmsg", "-range", `${base}..HEAD`], { PATH: GO_PATH });
    assertNotEquals(result.code, 0);
    assertStringIncludes(result.text, "missing what:");
    assertStringIncludes(result.text, invalidSha.slice(0, 7));
  });
});
