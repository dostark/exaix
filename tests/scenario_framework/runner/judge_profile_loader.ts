/**
 * @module JudgeProfileLoader
 * @path tests/scenario_framework/runner/judge_profile_loader.ts
 * @description Load bounded profile assets and selected judge evidence inside validated filesystem roots.
 * @architectural-layer Test
 * @dependencies @exaix/core/evaluation, @exaix/portal
 * @related-files [tests/scenario_framework/runner/main.ts, tests/scenario_framework/runner/assertions.ts]
 */

import { basename, dirname, join, relative, resolve } from "@std/path";
import {
  type ICandidateJudgeProfile,
  type IResolvedJudgeProfile,
  JudgeProfileError,
  parseCandidateJudgeProfile,
  resolveJudgeProfile,
} from "@exaix/core/evaluation";
import { PathResolver } from "@exaix/portal";
import { createMockConfig, createMockEventLogger } from "@exaix/testing";
import { DEFAULT_CALIBRATION_MAX_ITEM_BYTES } from "@exaix/eval-history";

const UNREADABLE: string = "judge-profile-unreadable";
const UNSAFE_ASSET: string = "judge-profile-unsafe-asset";

/** Bound every read, including a file that grows after its size check. */
async function readBounded(path: string, root: string): Promise<string> {
  const expected: Deno.FileInfo = await Deno.lstat(path);
  const physical: string = await Deno.realPath(path);
  if (!expected.isFile || expected.isSymlink || (physical !== root && !physical.startsWith(root + "/"))) {
    throw new JudgeProfileError(UNSAFE_ASSET);
  }
  using file: Deno.FsFile = await Deno.open(path, { read: true });
  const stat: Deno.FileInfo = await file.stat();
  if (expected.ino === null || expected.dev === null || expected.ino !== stat.ino || expected.dev !== stat.dev) {
    throw new JudgeProfileError(UNSAFE_ASSET);
  }
  if (!stat.isFile || stat.size > DEFAULT_CALIBRATION_MAX_ITEM_BYTES) throw new JudgeProfileError(UNREADABLE);
  const buffer: Uint8Array = new Uint8Array(DEFAULT_CALIBRATION_MAX_ITEM_BYTES + 1);
  let offset: number = 0;
  while (offset < buffer.length) {
    const count: number | null = await file.read(buffer.subarray(offset));
    if (count === null) break;
    offset += count;
  }
  if (offset > DEFAULT_CALIBRATION_MAX_ITEM_BYTES) throw new JudgeProfileError(UNREADABLE);
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
}

/** Profile assets have basename paths and cannot redirect reads through symlinks. */
export async function loadJudgeProfile(path: string): Promise<IResolvedJudgeProfile> {
  try {
    const requested: string = resolve(path);
    const canonical: string = await Deno.realPath(requested);
    if (canonical !== requested) throw new JudgeProfileError(UNSAFE_ASSET);
    const root: string = dirname(canonical);
    const raw: string = await readBounded(canonical, root);
    const spec: ICandidateJudgeProfile = parseCandidateJudgeProfile(raw);
    const assets: Record<string, string> = {};
    for (const name of [...spec.methodology_assets, spec.prompt_asset]) {
      const asset: string = join(root, name);
      if ((await Deno.lstat(asset)).isSymlink || dirname(await Deno.realPath(asset)) !== root) {
        throw new JudgeProfileError(UNSAFE_ASSET);
      }
      assets[name] = await readBounded(asset, root);
    }
    return await resolveJudgeProfile(raw, assets);
  } catch (error) {
    if (error instanceof JudgeProfileError) throw error;
    throw new JudgeProfileError(UNREADABLE);
  }
}

/** Selected profiles require declared evidence and reject filesystem escapes without falling back to stdout. */
export async function readSelectedJudgeEvidence(workspaceRoot: string, path: string): Promise<string> {
  try {
    const root: string = await Deno.realPath(workspaceRoot);
    const config = createMockConfig(dirname(root));
    config.paths.workspace = basename(root);
    const resolver: PathResolver = new PathResolver(config, { logger: createMockEventLogger() });
    const localPath: string = relative(root, resolve(root, path));
    const validated: string = await resolver.resolve(`@Workspace/${localPath}`);
    const requested: string = resolve(root, path);
    if (requested !== await Deno.realPath(requested)) throw new JudgeProfileError(UNSAFE_ASSET);
    return await readBounded(validated, root);
  } catch {
    throw new JudgeProfileError("judge-profile-unavailable-evidence");
  }
}
