/**
 * @module GoVulnGatesTest
 * @path tests/scripts/go_vuln_gates_test.ts
 * @description Exercises the pinned vulnerability scanner, advisory fixture and DB failure.
 * @architectural-layer Test
 */
import { assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { goCheckout } from "../../scripts/go_port/checkout.ts";
import { copyCheckout, GO, GO_PATH, make, run } from "./helpers/go_checkout_fixture.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const checkout = await goCheckout(ROOT, Deno.env.get("EXAIX_REQUIRE_GO") === "1");

function copy(dir: string): Promise<string> {
  if (!checkout) throw new Error("The Go checkout is required for this case");
  return copyCheckout(checkout, dir);
}

async function fixtureModule(dir: string, version: string): Promise<string> {
  const fixture = join(dir, "vulnfixture");
  await Deno.mkdir(fixture, { recursive: true });
  await Deno.writeTextFile(
    join(fixture, "go.mod"),
    `module example.com/vulnfixture\n\ngo 1.27.4\n\nrequire golang.org/x/net ${version}\n`,
  );
  await Deno.writeTextFile(
    join(fixture, "main.go"),
    `package main

import (
	"fmt"
	"strings"

	"golang.org/x/net/html"
)

func main() {
	_, err := html.Parse(strings.NewReader("<p>x</p>"))
	fmt.Println(err)
}
`,
  );
  return fixture;
}

function tidy(fixture: string): Promise<{ code: number; text: string }> {
  return run(fixture, GO, ["mod", "tidy"], { PATH: GO_PATH });
}

Deno.test("go-vuln: the pinned scanner reports its identity and a clean module", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const result = await make(repo, "vuln");
    assertEquals(result.code, 0, result.text);
    assertStringIncludes(result.text, "Scanner: govulncheck@v1.10.0");
    assertStringIncludes(result.text, "Go: go1.27.4");
    assertStringIncludes(result.text, "DB: https://vuln.go.dev");
    assertStringIncludes(result.text, "DB updated:");
    assertStringIncludes(result.text, "No vulnerabilities found.");
  });
});

Deno.test("go-vuln: a reachable advisory is reported and the fixed version is clean", {
  ignore: checkout === undefined,
}, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const vulnerable = await fixtureModule(dir, "v0.32.0");
    const tidyResult = await tidy(vulnerable);
    assertEquals(tidyResult.code, 0, tidyResult.text);
    const found = await run(repo, GO, ["tool", "govulncheck", "-C", vulnerable, "./..."], { PATH: GO_PATH });
    assertNotEquals(found.code, 0);
    assertStringIncludes(found.text, "GO-2024-3333");
    assertStringIncludes(found.text, "main.go");
    const fixed = await fixtureModule(dir, "v0.63.0");
    const fixedTidy = await tidy(fixed);
    assertEquals(fixedTidy.code, 0, fixedTidy.text);
    const clean = await run(repo, GO, ["tool", "govulncheck", "-C", fixed, "./..."], { PATH: GO_PATH });
    assertEquals(clean.code, 0, clean.text);
    assertStringIncludes(clean.text, "No vulnerabilities found.");
  });
});

Deno.test("go-vuln: an unavailable database fails the gate", { ignore: checkout === undefined }, async () => {
  await withTempDir(async (dir) => {
    const repo = await copy(dir);
    const result = await make(repo, "vuln", { VULN_DB: "http://127.0.0.1:1" });
    assertNotEquals(result.code, 0);
    assertStringIncludes(result.text, "vulndb");
  });
});
