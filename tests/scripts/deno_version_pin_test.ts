/**
 * @module DenoVersionPinTest
 * @path tests/scripts/deno_version_pin_test.ts
 * @description Keeps the Docker image on one pinned Deno version: every stage reads the build argument, no document repeats the number, and a containered run uses the pin.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/bump_deno_version.ts]
 */

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { denoPinProblems, pinnedDenoVersion, withDenoVersion } from "../../scripts/bump_deno_version.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SAMPLE = [
  "ARG DENO_VERSION=2.8.2",
  "FROM denoland/deno:${DENO_VERSION} AS builder",
  "FROM denoland/deno:${DENO_VERSION} AS runtime",
  "",
].join("\n");

Deno.test("deno-pin-reads-and-rewrites: the argument default is read and replaced in place", () => {
  assertEquals(pinnedDenoVersion(SAMPLE), "2.8.2");
  const bumped = withDenoVersion(SAMPLE, "2.9.8");
  assertEquals(pinnedDenoVersion(bumped), "2.9.8");
  assertEquals(bumped.replace("2.9.8", "2.8.2"), SAMPLE);
  assertEquals(pinnedDenoVersion("FROM denoland/deno:2.8.2"), null);
  assertThrows(() => withDenoVersion(SAMPLE, "2.9"), Error, "x.y.z");
  assertThrows(() => withDenoVersion("FROM scratch", "2.9.8"), Error, "DENO_VERSION");
});

Deno.test("deno-pin-problems: a literal tag, a missing argument and a repeated number are reported", () => {
  assertEquals(denoPinProblems(SAMPLE, { "ARCHITECTURE.md": "uses the pinned image" }), []);
  const literal = "ARG DENO_VERSION=2.9.8\nFROM denoland/deno:2.8.2 AS builder\n";
  assertEquals(denoPinProblems(literal, {}).length, 1);
  assertEquals(denoPinProblems("FROM denoland/deno:${DENO_VERSION}\n", {}).length, 1);
  const repeated = denoPinProblems(SAMPLE, { "ARCHITECTURE.md": "The builder (`denoland/deno:2.8.2`) vendors" });
  assertEquals(repeated.length, 1);
  assertStringIncludes(repeated[0], "ARCHITECTURE.md");
});

Deno.test("deno-pin-repository: the Dockerfile and the documents keep one pin", async () => {
  const dockerfile = await Deno.readTextFile(join(REPO_ROOT, "Dockerfile"));
  const architecture = await Deno.readTextFile(join(REPO_ROOT, "ARCHITECTURE.md"));
  assertEquals(denoPinProblems(dockerfile, { "ARCHITECTURE.md": architecture }), []);
});

/** True when the test process runs inside a container. */
async function insideContainer(): Promise<boolean> {
  return await Deno.stat("/.dockerenv").then(() => true, () => false);
}

Deno.test("deno-pin-runtime: a containered run uses the pinned version and a host run reports a difference", async () => {
  const pinned = pinnedDenoVersion(await Deno.readTextFile(join(REPO_ROOT, "Dockerfile")));
  assert(pinned !== null, "the Dockerfile must define DENO_VERSION");
  if (await insideContainer()) {
    assertEquals(Deno.version.deno, pinned);
    return;
  }
  const minor = (version: string): string => version.split(".").slice(0, 2).join(".");
  if (minor(Deno.version.deno) !== minor(pinned)) {
    console.warn(`deno-pin-runtime: this host runs Deno ${Deno.version.deno}, the image pin is ${pinned}`);
  }
});
