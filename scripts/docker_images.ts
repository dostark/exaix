#!/usr/bin/env -S deno run -A
/**
 * @module DockerImages
 * @path scripts/docker_images.ts
 * @description Docker image housekeeping for the images this repo builds. It removes the image a rebuild replaced
 *   and trims old build cache. It also names the build presets of the wrapper script.
 *   Usage: imported by scripts/test_isolation.ts and scripts/build_docker_image.ts
 * @architectural-layer Tooling
 * @dependencies [scripts/test_isolation.ts, tests/scenario_framework/runner/matrix_expander.ts]
 * @related-files [scripts/build_docker_image.ts, scripts/test_isolation.ts, tests/scripts/docker_images_test.ts]
 */

import type { Opt, Reason } from "@exaix/core/types";
import { dockerProbeSkipReason } from "../tests/scenario_framework/runner/matrix_expander.ts";

/** Injectable seams for the replaced-image cleanup. Every field defaults to the real docker call. */
export interface IReplacedImageSeams {
  /** The id behind an image name or id, or undefined when it cannot be read. Defaults to `docker image inspect`. */
  imageId?: Opt<(image: string) => Promise<string | undefined>, Reason.SensibleDefault>;
  /** How many tags still name the image id. Defaults to `docker image inspect`. */
  imageTagCount?: Opt<(id: string) => Promise<number>, Reason.SensibleDefault>;
  /** Removes an untagged image by id. Rejects when the image is in use. Defaults to `docker image rm`. */
  removeImage?: Opt<(id: string) => Promise<void>, Reason.SensibleDefault>;
}

const DOCKER_BIN = "docker";
const DOCKER_IMAGE_SUBCOMMAND = "image";
const DOCKER_INSPECT_SUBCOMMAND = "inspect";
const DOCKER_RM_SUBCOMMAND = "rm";
const DOCKER_FORMAT_FLAG = "--format";
const DOCKER_ID_TEMPLATE = "{{.Id}}";
const DOCKER_TAG_COUNT_TEMPLATE = "{{len .RepoTags}}";
const DOCKER_BUILDER_SUBCOMMAND = "builder";
const DOCKER_PRUNE_SUBCOMMAND = "prune";
const DOCKER_FORCE_FLAG = "-f";
const DOCKER_FILTER_FLAG = "--filter";
/** Unused build cache older than this is trimmed after an image rebuild. */
const BUILD_CACHE_MAX_AGE = "168h";

/** Injectable seams for `pruneStaleBuildCache`. Every field defaults to the real docker call. */
interface IPruneBuildCacheOptions {
  dockerOnPath?: Opt<() => boolean, Reason.SensibleDefault>;
  /** Exit code of the prune of unused build cache older than the given age. */
  prune?: Opt<(maxAge: string) => Promise<number>, Reason.SensibleDefault>;
}

/** The names of the images that the wrapper script builds. */
type TImagePresetName = "eval-jail" | "sandbox";

/** One image the wrapper script builds: the tag it produces and the docker command that builds it. */
interface IImagePreset {
  image: string;
  command: string[];
}

/** The images that the repo builds through a deno task. The key is the wrapper script argument. */
export const IMAGE_PRESETS: Readonly<Record<TImagePresetName, IImagePreset>> = {
  "eval-jail": {
    image: "exaix-eval-jail",
    command: ["docker", "build", "--target", "eval-jail", "-t", "exaix-eval-jail", "."],
  },
  "sandbox": {
    image: "exaix-sandbox:dev",
    command: ["docker", "compose", "-f", "compose.sandbox.yaml", "build"],
  },
};

/** The id behind an image name or id, or undefined when docker cannot read it. */
export async function dockerImageId(image: string): Promise<string | undefined> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [DOCKER_IMAGE_SUBCOMMAND, DOCKER_INSPECT_SUBCOMMAND, DOCKER_FORMAT_FLAG, DOCKER_ID_TEMPLATE, image],
    stdout: "piped",
    stderr: "null",
  }).output();
  const id = new TextDecoder().decode(out.stdout).trim();
  return out.success && id.length > 0 ? id : undefined;
}

async function defaultImageTagCount(id: string): Promise<number> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [DOCKER_IMAGE_SUBCOMMAND, DOCKER_INSPECT_SUBCOMMAND, DOCKER_FORMAT_FLAG, DOCKER_TAG_COUNT_TEMPLATE, id],
    stdout: "piped",
    stderr: "null",
  }).output();
  const count = Number.parseInt(new TextDecoder().decode(out.stdout).trim(), 10);
  // An unreadable count counts as tagged, so the image is kept.
  return out.success && Number.isInteger(count) ? count : 1;
}

async function defaultRemoveImage(id: string): Promise<void> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [DOCKER_IMAGE_SUBCOMMAND, DOCKER_RM_SUBCOMMAND, id],
    stdout: "null",
    stderr: "null",
  }).output();
  if (!out.success) throw new Error(`docker image rm ${id} failed`);
}

/** Removes the image a rebuild replaced. It keeps an image that still carries a tag, and it never fails the run. */
export async function removeReplacedImage(
  replacedId: Opt<string, Reason.OptionalInput>,
  image: string,
  seams: IReplacedImageSeams = {},
): Promise<void> {
  if (replacedId === undefined) return;
  const currentId = await (seams.imageId ?? dockerImageId)(image);
  if (currentId === undefined || currentId === replacedId) return;
  if (await (seams.imageTagCount ?? defaultImageTagCount)(replacedId) > 0) return;
  try {
    await (seams.removeImage ?? defaultRemoveImage)(replacedId);
    console.log(`› removed the replaced image ${replacedId}`);
  } catch {
    // A running container may still use the old image. It is not retried.
  }
}

/** Runs `build` and removes the image it replaced. A failed build keeps the old image. Resolves with the build exit code. */
export async function buildReplacingImage(
  image: string,
  build: () => Promise<number>,
  seams: IReplacedImageSeams = {},
): Promise<number> {
  const replacedId = await (seams.imageId ?? dockerImageId)(image);
  const exitCode = await build();
  if (exitCode === 0) await removeReplacedImage(replacedId, image, seams);
  return exitCode;
}

async function defaultPruneBuildCache(maxAge: string): Promise<number> {
  const out = await new Deno.Command(DOCKER_BIN, {
    args: [
      DOCKER_BUILDER_SUBCOMMAND,
      DOCKER_PRUNE_SUBCOMMAND,
      DOCKER_FORCE_FLAG,
      DOCKER_FILTER_FLAG,
      `until=${maxAge}`,
    ],
    stdout: "null",
    stderr: "null",
  }).output();
  return out.code;
}

/** Trims unused build cache older than a week. The runner calls it after a rebuild, when the cache just grew.
 *  A failed prune is ignored, because a full cache only costs disk space. */
export async function pruneStaleBuildCache(
  options: Opt<IPruneBuildCacheOptions, Reason.SensibleDefault> = {},
): Promise<void> {
  const dockerOnPath = options.dockerOnPath ?? (() => dockerProbeSkipReason() === null);
  if (!dockerOnPath()) return;
  try {
    await (options.prune ?? defaultPruneBuildCache)(BUILD_CACHE_MAX_AGE);
  } catch {
    // The prune is housekeeping only.
  }
}
