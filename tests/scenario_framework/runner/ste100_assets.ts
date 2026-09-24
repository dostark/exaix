/**
 * @module Ste100Assets
 * @path tests/scenario_framework/runner/ste100_assets.ts
 * @description Reconstructable baseline and isolated-output helpers for the Phase 195 STE
 *   conversion. `freezeSte100Baseline` stores exact pre-conversion source/generated/
 *   configuration bytes as content-addressed blobs under the ste100 fixtures dir and
 *   binds a `sourceStateHash` to the dirty working state; `reconstructSte100Baseline`
 *   validates hashes and restores the exact bytes, rejecting omitted active dependencies
 *   and tampered blobs. `assertIsolatedTarget`/`createExclusiveIsolatedDir`/
 *   `revalidateIsolatedTarget` preflight arm output paths (rejecting escaped, symlinked,
 *   sibling-prefix, and overlapping targets) before the existing generators run, and
 *   `runIsolatedGenerator` drives `buildSkillsIndex`/`generateSkillJson` against an
 *   isolated arm root. `withSte100Arm` guarantees cleanup in `finally`. Step 1 asset
 *   module; Steps 3-6 build on it.
 * @architectural-layer Test
 * @related-files [
 *   "tests/scenario_framework/tests/unit/ste100_assets_test.ts",
 *   "scripts/build_skills_index.ts",
 *   "scripts/generate_skill_json.ts"
 * ]
 */

import { exists } from "@std/fs";
import { basename, dirname, isAbsolute, join, relative, resolve, SEPARATOR } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import { buildSkillsIndex } from "../../../scripts/build_skills_index.ts";
import { generateSkillJson } from "../../../scripts/generate_skill_json.ts";

export type Ste100BaselineKind = "source" | "generated" | "configuration";

export interface ISte100BaselineEntry {
  /** Absolute path of the frozen file inside the baseline root. */
  path: string;
  /** Path relative to the baseline root (the canonical key). */
  relPath: string;
  /** SHA-256 hex of the original bytes. */
  contentHash: string;
  /** Absolute path of the content-addressed blob (`<baselineDir>/blobs/<hash>`). */
  blobPath: string;
  kind: Ste100BaselineKind;
}

export interface ISte100Baseline {
  version: typeof BASELINE_VERSION;
  root: string;
  baselineDir: string;
  /** Binds the root, optional parent/edition commit HEADs, every entry's relPath/hash/
   *  kind, and the manifest. */
  sourceStateHash: string;
  generatedAt: string;
  entries: ISte100BaselineEntry[];
  /** Active dependencies reconstruction requires; a missing entry is a reject. */
  requiredPaths: string[];
  /** Parent/edition commit HEADs recorded at freeze time (empty when caller-supplied). */
  commitHashes: string[];
}

export interface ISte100FreezeInput {
  root: string;
  baselineDir: string;
  /** Absolute paths of the source/generated/configuration files to freeze. */
  targets: string[];
  /** Optional relPath -> kind classification; default `"source"`. */
  kinds?: Partial<Record<string, Ste100BaselineKind>>;
  /** Active dependencies that must be reconstructable; default is every target. */
  requiredPaths?: string[];
  /** Optional parent/edition commit HEADs bound into `sourceStateHash`; supplied by the
   *  calling script (the framework runner must not spawn `git` itself). */
  commitHashes?: string[];
}

export interface ISte100IsolatedGeneratorInput {
  kind: "skills" | "skill-json";
  root: string;
  sourceDir: string;
  targetDir: string;
  existingTrees?: string[];
}

export const STE100_PATH_ERROR_CODES = [
  "ste100-escaped",
  "ste100-symlink",
  "ste100-sibling-prefix",
  "ste100-overlap",
  "ste100-exists",
] as const;
export type Ste100PathErrorCode = (typeof STE100_PATH_ERROR_CODES)[number];

/** A preflight rejection of an isolated arm output path. */
export class Ste100PathError extends Error {
  constructor(
    public readonly code: Ste100PathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "Ste100PathError";
  }
}

const BASELINE_VERSION = 1;
const BASELINE_MANIFEST_FILE = "manifest.json";
const BASELINE_BLOBS_DIR = "blobs";

async function hashBytes(bytes: Uint8Array): Promise<string> {
  // A fresh copy carries an ArrayBuffer backing so it satisfies crypto.subtle.digest's
  // BufferSource constraint regardless of the source buffer type.
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hashText(text: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(text));
}

function relativeSafe(root: string, target: string): string {
  const rel = relative(root, resolve(target));
  if (rel === "" || rel === "." || isAbsolute(rel) || rel.split(SEPARATOR).includes("..")) {
    throw new Ste100PathError("ste100-escaped", `Path ${target} is outside isolated root ${root}`);
  }
  return rel;
}

/** Freezes `targets` as content-addressed blobs under `baselineDir` and returns the
 *  reconstructable baseline. Refuses any target that is missing or outside the root. */
export async function freezeSte100Baseline(input: ISte100FreezeInput): Promise<ISte100Baseline> {
  const root = resolve(input.root);
  const baselineDir = resolve(input.baselineDir);
  await Deno.mkdir(join(baselineDir, BASELINE_BLOBS_DIR), { recursive: true });

  const entries: ISte100BaselineEntry[] = [];
  for (const target of input.targets) {
    const absolute = resolve(target);
    const relPath = relativeSafe(root, absolute);
    if (!(await exists(absolute))) {
      throw new Error(`Baseline target ${absolute} does not exist`);
    }
    const bytes = await Deno.readFile(absolute);
    const contentHash = await hashBytes(bytes);
    const blobPath = join(baselineDir, BASELINE_BLOBS_DIR, contentHash);
    if (!(await exists(blobPath))) {
      await Deno.writeFile(blobPath, bytes);
    }
    const kind = input.kinds?.[relPath] ?? "source";
    entries.push({ path: absolute, relPath, contentHash, blobPath, kind });
  }
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const generatedAt = new Date().toISOString();
  const requiredPaths = [...new Set(input.requiredPaths ?? input.targets.map((t) => relativeSafe(root, t)))].sort();
  const baseline: ISte100Baseline = {
    version: BASELINE_VERSION,
    root,
    baselineDir,
    sourceStateHash: "",
    generatedAt,
    entries,
    requiredPaths,
    commitHashes: [...new Set(input.commitHashes ?? [])].sort(),
  };
  baseline.sourceStateHash = await computeSourceStateHash(baseline);
  await Deno.writeTextFile(
    join(baselineDir, BASELINE_MANIFEST_FILE),
    JSON.stringify(baseline, null, 2) + "\n",
  );
  return baseline;
}

function computeSourceStateHash(baseline: ISte100Baseline): Promise<string> {
  const body = [
    baseline.root,
    ...baseline.commitHashes,
    ...baseline.entries.map((entry) => `${entry.relPath}:${entry.contentHash}:${entry.kind}`),
  ].join("\n");
  return hashText(body);
}

/** Validates the frozen state and restores the exact pre-conversion bytes for every
 *  entry. Rejects an omitted active dependency and any tampered/missing blob. Returns
 *  the restored absolute paths. */
export async function reconstructSte100Baseline(baseline: ISte100Baseline): Promise<string[]> {
  const expectedStateHash = await computeSourceStateHash(baseline);
  if (baseline.sourceStateHash !== expectedStateHash) {
    throw new Error("ste100 baseline state hash mismatch: working state changed after the freeze");
  }

  for (const rel of baseline.requiredPaths) {
    if (!baseline.entries.some((entry) => entry.relPath === rel)) {
      throw new Error(`ste100 baseline rejects omitted active dependency: ${rel}`);
    }
  }

  const restored: string[] = [];
  for (const entry of baseline.entries) {
    if (!(await exists(entry.blobPath))) {
      throw new Error(`ste100 baseline missing blob for ${entry.relPath}: ${entry.blobPath}`);
    }
    const blobBytes = await Deno.readFile(entry.blobPath);
    const blobHash = await hashBytes(blobBytes);
    if (blobHash !== entry.contentHash) {
      throw new Error(`ste100 baseline hash mismatch for ${entry.relPath}`);
    }
    const relPath = relativeSafe(baseline.root, entry.path);
    const restorePath = join(baseline.root, relPath);
    await Deno.mkdir(dirname(restorePath), { recursive: true });
    await Deno.writeFile(restorePath, blobBytes);
    restored.push(restorePath);
  }
  return restored;
}

/** Resolves the real path of the nearest existing ancestor of `path`, or null when none. */
function nearestRealpathAncestor(path: string): string | null {
  let current = path;
  for (;;) {
    try {
      return Deno.realPathSync(current);
    } catch {
      const parent = dirname(current);
      if (parent === current || parent === dirname(parent)) return null;
      current = parent;
    }
  }
}

function realRootPrefix(realRoot: string): string {
  return realRoot.endsWith(SEPARATOR) ? realRoot : realRoot + SEPARATOR;
}

/** Preflight for an isolated arm output path: rejects escapes, symlinked ancestors/
 *  outputs, the `prefix`<->`prefix-extra` sibling trap, and overlap with existing trees. */
export function assertIsolatedTarget(target: string, root: string, existingTrees: string[] = []): string {
  const absoluteTarget = resolve(target);
  const absoluteRoot = resolve(root);
  const rel = relativeSafe(absoluteRoot, absoluteTarget);

  // Reject a symlinked ancestor before the output could be reached through it.
  const segments = rel.split(SEPARATOR);
  let current = absoluteRoot;
  for (const segment of segments) {
    current = join(current, segment);
    let stat: Deno.FileInfo | null = null;
    try {
      stat = Deno.lstatSync(current);
    } catch {
      break; // tail not created yet and therefore cannot be a symlink
    }
    if (stat.isSymlink) {
      throw new Ste100PathError("ste100-symlink", `Target ${absoluteTarget} crosses symlinked path ${current}`);
    }
  }

  // The real nearest ancestor must stay inside (or at) the real root once the path
  // exists — an unresolved target's nearest ancestor is the root itself.
  const realRoot = nearestRealpathAncestor(absoluteRoot);
  const realAncestor = nearestRealpathAncestor(absoluteTarget);
  if (
    realRoot && realAncestor &&
    realAncestor !== realRoot &&
    !realAncestor.startsWith(realRootPrefix(realRoot))
  ) {
    throw new Ste100PathError(
      "ste100-symlink",
      `Target ${absoluteTarget} resolves outside isolated root ${absoluteRoot}`,
    );
  }

  // Overlapping source/output/evidence trees.
  for (const tree of existingTrees) {
    let existingRel: string;
    try {
      existingRel = relativeSafe(absoluteRoot, tree);
    } catch {
      continue;
    }
    if (rel === existingRel || rel.startsWith(existingRel + SEPARATOR) || existingRel.startsWith(rel + SEPARATOR)) {
      throw new Ste100PathError("ste100-overlap", `Target ${absoluteTarget} overlaps existing tree ${tree}`);
    }
  }

  // Sibling-prefix ambiguity: an existing sibling directory whose name is a strict string
  // prefix of the candidate leaf (or vice versa) would fool string-prefix path helpers.
  const parent = dirname(absoluteTarget);
  const leaf = basename(absoluteTarget);
  let siblings: Deno.DirEntry[] = [];
  try {
    siblings = [...Deno.readDirSync(parent)];
  } catch {
    siblings = [];
  }
  for (const sibling of siblings) {
    if (sibling.name === leaf || !sibling.isDirectory) continue;
    if (sibling.name.startsWith(leaf) || leaf.startsWith(sibling.name)) {
      throw new Ste100PathError(
        "ste100-sibling-prefix",
        `Target ${absoluteTarget} is confusable with sibling ${join(parent, sibling.name)}`,
      );
    }
  }

  return absoluteTarget;
}

/** Creates `target` exclusively and revalidates it against the isolated root.
 *  Refuses an already-existing output or one that resolves outside the root. */
export async function createExclusiveIsolatedDir(
  target: string,
  root: string,
  existingTrees: string[] = [],
): Promise<string> {
  const absolute = assertIsolatedTarget(target, root, existingTrees);
  try {
    await Deno.mkdir(absolute);
  } catch {
    if (await exists(absolute)) {
      throw new Ste100PathError("ste100-exists", `Isolated output ${absolute} already exists`);
    }
    throw new Ste100PathError("ste100-exists", `Isolated output ${absolute} could not be created exclusively`);
  }
  await revalidateIsolatedTarget(absolute, root);
  return absolute;
}

/** Revalidates an existing isolated output: it must resolve under the real root and not
 *  be a symlink. */
export function revalidateIsolatedTarget(target: string, root: string): void {
  const realRoot = nearestRealpathAncestor(resolve(root));
  const realTarget = nearestRealpathAncestor(resolve(target));
  if (!realRoot || !realTarget || !realTarget.startsWith(realRootPrefix(realRoot))) {
    throw new Ste100PathError("ste100-symlink", `Isolated output ${target} resolved outside root ${root}`);
  }
  let stat: Deno.FileInfo;
  try {
    stat = Deno.lstatSync(resolve(target));
  } catch {
    throw new Ste100PathError("ste100-exists", `Isolated output ${target} does not exist`);
  }
  if (stat.isSymlink) {
    throw new Ste100PathError("ste100-symlink", `Isolated output ${target} is a symlink`);
  }
}

/** Preflights and creates an isolated arm output, then runs the named production
 *  generator with explicit arm sources; output is revalidated afterwards. */
export async function runIsolatedGenerator(
  input: ISte100IsolatedGeneratorInput,
  options?: Opt<{ check?: boolean }, Reason.ExecutionConfig>,
): Promise<{ success: boolean; generated: string[]; errors: string[]; warnings: string[] }> {
  const absoluteTarget = await createExclusiveIsolatedDir(input.targetDir, input.root, input.existingTrees);
  if (input.kind === "skills") {
    const result = await buildSkillsIndex(input.sourceDir, absoluteTarget, input.root, options);
    await revalidateIsolatedTarget(absoluteTarget, input.root);
    return result;
  }
  const result = await generateSkillJson(input.sourceDir, absoluteTarget, input.root, options);
  await revalidateIsolatedTarget(absoluteTarget, input.root);
  return result;
}

/** Runs `fn` and guarantees `cleanup` runs in `finally`, including on throw. */
export async function withSte100Arm<T>(
  fn: () => Promise<T>,
  cleanup: () => Promise<void> | void,
): Promise<T> {
  try {
    return await fn();
  } finally {
    await cleanup();
  }
}
