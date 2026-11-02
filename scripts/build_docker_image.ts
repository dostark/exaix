#!/usr/bin/env -S deno run -A
/**
 * @module BuildDockerImage
 * @path scripts/build_docker_image.ts
 * @description Builds one of the repo's docker images and then removes the image that the build replaced.
 *   It also trims old build cache. A failed build keeps the old image and exits with the build exit code.
 *   Usage: deno run -A scripts/build_docker_image.ts <eval-jail|sandbox>
 * @architectural-layer Tooling
 * @dependencies [@std/path, @exaix/core/types, scripts/docker_images.ts]
 * @related-files [scripts/docker_images.ts, tests/scripts/docker_images_test.ts, deno.json]
 */

import { fromFileUrl, join } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import { buildReplacingImage, IMAGE_PRESETS, pruneStaleBuildCache } from "./docker_images.ts";

const REPO_ROOT = join(fromFileUrl(import.meta.url), "..", "..");
const USAGE_EXIT_CODE = 2;

function isPresetName(name: Opt<string, Reason.OptionalInput>): name is keyof typeof IMAGE_PRESETS {
  return name !== undefined && Object.hasOwn(IMAGE_PRESETS, name);
}

/** Runs a build command in the repo root with inherited output and resolves with its exit code. */
async function runBuild(command: readonly string[]): Promise<number> {
  const [bin, ...args] = command;
  const out = await new Deno.Command(bin, { args, cwd: REPO_ROOT, stdout: "inherit", stderr: "inherit" }).output();
  return out.code;
}

async function main(args: readonly string[]): Promise<number> {
  const name = args[0];
  if (!isPresetName(name)) {
    console.error(`Usage: deno run -A scripts/build_docker_image.ts <${Object.keys(IMAGE_PRESETS).join("|")}>`);
    return USAGE_EXIT_CODE;
  }
  const preset = IMAGE_PRESETS[name];
  const exitCode = await buildReplacingImage(preset.image, () => runBuild(preset.command));
  if (exitCode === 0) await pruneStaleBuildCache();
  return exitCode;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
