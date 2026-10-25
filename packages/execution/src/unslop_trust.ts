/**
 * @module UnslopTrust
 * @path packages/execution/src/unslop_trust.ts
 * @description Keeps trusted lint assets and private inputs outside model-editable roots.
 * @architectural-layer Services
 * @dependencies [@std/path, @exaix/core, @exaix/schemas]
 * @related-files [packages/execution/src/unslop_check_runner.ts, packages/execution/tests/unslop_verification_security_test.ts]
 */

import { join, SEPARATOR } from "@std/path";
import { UNSLOP_RUNTIME_DIR } from "@exaix/core";
import { UnslopErrorClass } from "@exaix/schemas";
import type { IUnslopCheckContext, IUnslopCheckRunnerOptions } from "./unslop_check_types.ts";
import { UnslopCheckError } from "./unslop_check_error.ts";

/** An exclusively created directory and its physical filesystem identity. */
export interface IUnslopPrivateDirectory {
  readonly path: string;
  readonly root: string;
  readonly dev: number | null;
  readonly ino: number | null;
}

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_PREFIX = "run-";

function contains(root: string, path: string): boolean {
  return path === root || path.startsWith(root + SEPARATOR);
}

/** Requires a physical operator-owned root independent of every portal. */
export async function assertUnslopTrustedRoot(
  path: string,
  context: IUnslopCheckContext,
  options: IUnslopCheckRunnerOptions,
): Promise<void> {
  const realPath = await Deno.realPath(path);
  for (const root of [context.executionRoot, ...options.portalRoots ?? []]) {
    let realRoot: string;
    try {
      realRoot = await Deno.realPath(root);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    if (contains(realRoot, realPath)) {
      throw new UnslopCheckError(UnslopErrorClass.ASSET_INVALID);
    }
  }
}

/** Validates before creation and records the owned directory's physical identity. */
export async function createUnslopPrivateDirectory(
  context: IUnslopCheckContext,
  options: IUnslopCheckRunnerOptions,
): Promise<IUnslopPrivateDirectory> {
  const runtime = await options.pathResolver.resolve("@Runtime");
  await assertUnslopTrustedRoot(runtime, context, options);
  const parent = await options.pathResolver.validatePath(join(runtime, UNSLOP_RUNTIME_DIR), [runtime]);
  try {
    if ((await Deno.lstat(parent)).isSymlink) throw new UnslopCheckError(UnslopErrorClass.ASSET_INVALID);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(parent, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await options.pathResolver.validatePath(parent, [runtime]);
  await assertUnslopTrustedRoot(parent, context, options);
  const path = await Deno.makeTempDir({ dir: parent, prefix: PRIVATE_PREFIX });
  const physical = await Deno.realPath(path);
  const metadata = await Deno.lstat(path);
  return { path: physical, root: runtime, dev: metadata.dev, ino: metadata.ino };
}

/** Validates each private operand and creates it exclusively without following a precreated link. */
export async function writeUnslopPrivateInput(
  dir: string,
  name: string,
  bytes: Uint8Array,
  options: IUnslopCheckRunnerOptions,
): Promise<void> {
  try {
    const path = await options.pathResolver.validatePath(join(dir, name), [dir]);
    await Deno.writeFile(path, bytes, { createNew: true, mode: PRIVATE_FILE_MODE });
  } catch {
    throw new UnslopCheckError(UnslopErrorClass.ASSET_INVALID);
  }
}

/** Refuses cleanup after ownership or physical-path replacement. */
export async function removeUnslopPrivateDirectory(
  directory: IUnslopPrivateDirectory,
  options: IUnslopCheckRunnerOptions,
): Promise<void> {
  try {
    await options.pathResolver.validatePath(directory.path, [directory.root]);
    const physical = await Deno.realPath(directory.path);
    const metadata = await Deno.lstat(directory.path);
    if (
      physical !== directory.path || metadata.isSymlink || !metadata.isDirectory ||
      metadata.dev !== directory.dev || metadata.ino !== directory.ino
    ) {
      throw new UnslopCheckError(UnslopErrorClass.ASSET_INVALID);
    }
    await Deno.remove(directory.path, { recursive: true });
  } catch {
    throw new UnslopCheckError(UnslopErrorClass.ASSET_INVALID);
  }
}
