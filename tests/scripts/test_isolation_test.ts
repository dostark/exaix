/**
 * @module TestIsolationTest
 * @path tests/scripts/test_isolation_test.ts
 * @description Verifies the dev-test image provider (`ensureDevTestImage`) and the
 *   `dev-test` Dockerfile stage / `.dockerignore` build-context contract.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { ensureDevTestImage } from "../../scripts/test_isolation.ts";

const DOCKERFILE = await Deno.readTextFile(new URL("../../Dockerfile", import.meta.url));
const DOCKERIGNORE = await Deno.readTextFile(new URL("../../.dockerignore", import.meta.url));

/** The `dev-test` stage block: from its `FROM … AS dev-test` line to the next `FROM`. */
function devTestStage(dockerfile: string): string {
  const lines = dockerfile.split("\n");
  const start = lines.findIndex((line) => line.includes("AS dev-test"));
  if (start === -1) throw new Error("no `AS dev-test` stage in Dockerfile");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("FROM "));
  return lines.slice(start, end === -1 ? undefined : start + 1 + end).join("\n");
}

Deno.test("dev-test image provider builds only when the image is absent", async () => {
  let builtWhenAbsent = 0;
  await ensureDevTestImage("exaix-dev-test:test", {
    dockerOnPath: () => true,
    imageExists: () => Promise.resolve(false),
    build: () => {
      builtWhenAbsent++;
      return Promise.resolve(0);
    },
  });
  assertEquals(builtWhenAbsent, 1);

  let builtWhenPresent = 0;
  await ensureDevTestImage("exaix-dev-test:test", {
    dockerOnPath: () => true,
    imageExists: () => Promise.resolve(true),
    build: () => {
      builtWhenPresent++;
      return Promise.resolve(0);
    },
  });
  assertEquals(builtWhenPresent, 0);
});

Deno.test("ensureDevTestImage surfaces a build failure", async () => {
  await assertRejects(
    () =>
      ensureDevTestImage("exaix-dev-test:test", {
        dockerOnPath: () => true,
        imageExists: () => Promise.resolve(false),
        build: () => Promise.resolve(1),
      }),
    Error,
    "dev-test image build failed",
  );
});

Deno.test("ensureDevTestImage is a no-op when the docker binary is absent", async () => {
  let probed = false;
  await ensureDevTestImage("exaix-dev-test:test", {
    dockerOnPath: () => false,
    imageExists: () => {
      probed = true;
      return Promise.resolve(false);
    },
  });
  assertEquals(probed, false);
});

Deno.test("dev-test stage inherits builder and adds git without reinstalling the delegate CLIs", () => {
  const stage = devTestStage(DOCKERFILE);
  assert(stage.startsWith("FROM builder AS dev-test"), stage);
  assert(stage.includes("git"), "the dev-test stage installs git");
  assert(!stage.includes("npm install -g"), "the dev-test stage must not reinstall the delegate CLIs");
});

Deno.test("the dev-test stage installs procps so pkill is available to the driver", () => {
  assert(devTestStage(DOCKERFILE).includes("procps"), "dev-test installs procps");
});

Deno.test("the dev-test stage makes /deno-dir writable for an arbitrary uid", () => {
  assert(
    devTestStage(DOCKERFILE).includes("chmod -R a+rwX /deno-dir"),
    "dev-test makes /deno-dir uid-writable",
  );
});

Deno.test("the dev-test stage copies scripts/ and caches the driver entrypoint, not the whole scripts/ tree", () => {
  const stage = devTestStage(DOCKERFILE);
  assert(stage.includes("COPY scripts/ scripts/"), "dev-test copies scripts/");
  assert(stage.includes("scripts/test_container_driver.ts"), "dev-test caches the driver entrypoint");
});

Deno.test("the build context un-excludes tests/ for the dev-test image", () => {
  assert(
    DOCKERIGNORE.split("\n").includes("!tests/"),
    ".dockerignore un-excludes tests/ for the dev-test image",
  );
});
