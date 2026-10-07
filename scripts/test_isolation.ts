#!/usr/bin/env -S deno run -A
/**
 * @module TestIsolation
 * @path scripts/test_isolation.ts
 * @description Host-side test-isolation tooling for the Batch-2 container path. This step
 *   adds only `ensureDevTestImage`: it probes the local docker image store and builds the
 *   `dev-test` image (Dockerfile target `dev-test`) once when it is missing, so the worker
 *   containers have a warm module cache. Later steps add the worker-container launcher and
 *   the work-stealing dispatch queue.
 * Usage:
 *   Imported as a library by `scripts/test_parallel.ts` (Step 4). No standalone CLI yet.
 *   `ensureDevTestImage(image)` builds the image only when `docker image inspect` misses it.
 * @architectural-layer Tooling
 * @dependencies [@std/path, tests/scenario_framework/runner/matrix_expander.ts]
 * @related-files [Dockerfile, .dockerignore, tests/scripts/test_isolation_test.ts]
 */

import { fromFileUrl, join } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import { dockerProbeSkipReason } from "../tests/scenario_framework/runner/matrix_expander.ts";

/** Injectable seams for `ensureDevTestImage`. Every field defaults to the real docker call. */
export interface IEnsureDevTestImageOptions {
  /** True when the `docker` binary is on PATH. Defaults to the shared `dockerProbeSkipReason`. */
  dockerOnPath?: Opt<() => boolean, Reason.SensibleDefault>;
  /** True when `image` is present in the local image store. Defaults to `docker image inspect`. */
  imageExists?: Opt<(image: string) => Promise<boolean>, Reason.SensibleDefault>;
  /** Exit code of the image build. Defaults to `docker build --target dev-test`. */
  build?: Opt<(image: string) => Promise<number>, Reason.SensibleDefault>;
}

const REPO_ROOT = join(fromFileUrl(import.meta.url), "..", "..");

const DOCKER_BIN = "docker";
const DOCKER_IMAGE_SUBCOMMAND = "image";
const DOCKER_INSPECT_SUBCOMMAND = "inspect";
const DOCKER_BUILD_SUBCOMMAND = "build";
const DOCKER_TARGET_FLAG = "--target";
const DEV_TEST_TARGET = "dev-test";
const DOCKER_TAG_FLAG = "-t";
const DOCKER_BUILD_CONTEXT = ".";

/** True when `image` is present in the local docker image store. */
async function defaultImageExists(image: string): Promise<boolean> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [DOCKER_IMAGE_SUBCOMMAND, DOCKER_INSPECT_SUBCOMMAND, image],
    stdout: "null",
    stderr: "null",
  }).output();
  return out.success;
}

/** Builds the `dev-test` image from the repo root and returns the process exit code. */
async function defaultBuildImage(image: string): Promise<number> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [
      DOCKER_BUILD_SUBCOMMAND,
      DOCKER_TARGET_FLAG,
      DEV_TEST_TARGET,
      DOCKER_TAG_FLAG,
      image,
      DOCKER_BUILD_CONTEXT,
    ],
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return out.code;
}

/** Ensure the `dev-test` image exists, building it once when absent. It is a no-op when the
 *  `docker` binary is missing, so the caller falls back to the serial path. A failed build
 *  throws, so a broken image is never silently used. */
export async function ensureDevTestImage(
  image: string,
  options: Opt<IEnsureDevTestImageOptions, Reason.SensibleDefault> = {},
): Promise<void> {
  const dockerOnPath = options.dockerOnPath ?? (() => dockerProbeSkipReason() === null);
  if (!dockerOnPath()) return;

  const imageExists = options.imageExists ?? defaultImageExists;
  if (await imageExists(image)) return;

  const build = options.build ?? defaultBuildImage;
  const exitCode = await build(image);
  if (exitCode !== 0) {
    throw new Error(`dev-test image build failed with exit code ${exitCode}`);
  }
}
