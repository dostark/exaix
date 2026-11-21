/**
 * @module GoLintGatesTest
 * @path tests/scripts/go_lint_gates_test.ts
 * @description Exercises the pinned golangci-lint lock, integrity check and rule seeds.
 * @architectural-layer Test
 */
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { goCheckout } from "../../scripts/go_port/checkout.ts";
import { copyCheckout, make, run } from "./helpers/go_checkout_fixture.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const checkout = await goCheckout(ROOT, Deno.env.get("EXAIX_REQUIRE_GO") === "1");
const VERSION = "golangci-lint has version 2.15.0 built with go1.27.0";

function copy(dir: string): Promise<string> {
  if (!checkout) throw new Error("The Go checkout is required for this case");
  return copyCheckout(checkout, dir);
}

function cache(dir: string): Record<string, string> {
  return { EXAIX_GO_LINT_CACHE: join(dir, "lint-cache") };
}

Deno.test("go-lint-version: the lock and both entry points report one tool version", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const env = cache(dir);
    const version = await make(repo, "lint-version", env);
    assertEquals(version.code, 0, version.text);
    assertStringIncludes(version.text, VERSION);
    const check = await make(repo, "check", env);
    assertEquals(check.code, 0, check.text);
    assertStringIncludes(check.text, VERSION);
    const ci = await make(repo, "ci", env);
    assertEquals(ci.code, 0, ci.text);
    assertStringIncludes(ci.text, VERSION);
  });
});

Deno.test("go-lint-integrity: a corrupted cached binary is rejected before execution", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const env = cache(dir);
    const first = await make(repo, "lint-version", env);
    assertEquals(first.code, 0, first.text);
    const found = await run(dir, "find", [env.EXAIX_GO_LINT_CACHE, "-name", "golangci-lint", "-type", "f"]);
    assertEquals(found.code, 0, found.text);
    const binary = found.text.trim().split("\n")[0];
    assert(binary.length > 0);
    await Deno.writeTextFile(binary, "corrupted");
    const rejected = await make(repo, "lint-version", env);
    assertNotEquals(rejected.code, 0);
    assertStringIncludes(rejected.text, "cached binary digest mismatch");
  });
});

const seeds = [
  {
    name: "complexity",
    source: `package lintseed

func Complex(value int) int {
	switch value {
	case 0:
		return 0
	case 1:
		return 1
	case 2:
		return 2
	case 3:
		return 3
	case 4:
		return 4
	case 5:
		return 5
	case 6:
		return 6
	case 7:
		return 7
	case 8:
		return 8
	case 9:
		return 9
	case 10:
		return 10
	case 11:
		return 11
	case 12:
		return 12
	case 13:
		return 13
	case 14:
		return 14
	case 15:
		return 15
	default:
		return -1
	}
}
`,
    marker: ["gocyclo", "gocognit"],
  },
  {
    name: "literal",
    source: `package lintseed

func Literal() int {
	return 42
}
`,
    marker: ["mnd", "Magic number: 42"],
  },
  {
    name: "errcheck",
    source: `package lintseed

import "os"

func Ignore() {
	os.Remove("seed")
}
`,
    marker: ["errcheck"],
  },
  {
    name: "export",
    source: `package lintseed

func Exported() {}
`,
    marker: ["revive", "exported"],
  },
];

Deno.test("go-lint-seeds: each rule seed fails and the clean tree is restored", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const env = cache(dir);
    for (const seed of seeds) {
      const packageDir = join(repo, "lintseed");
      await Deno.mkdir(packageDir, { recursive: true });
      await Deno.writeTextFile(join(packageDir, "seed.go"), seed.source);
      const result = await make(repo, "lint", env);
      assertNotEquals(result.code, 0, `${seed.name} passed:\n${result.text}`);
      const matched = seed.marker.some((marker) => result.text.includes(marker));
      assert(matched, `${seed.name} did not report ${seed.marker.join(" or ")}:\n${result.text}`);
      assertStringIncludes(result.text, "lintseed/seed.go");
      await Deno.remove(packageDir, { recursive: true });
    }
    const clean = await make(repo, "lint", env);
    assertEquals(clean.code, 0, clean.text);
    assertStringIncludes(clean.text, "0 issues.");
  });
});
