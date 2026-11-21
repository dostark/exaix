#!/usr/bin/env -S deno run -A
/**
 * @module GoPortSnapshotManifest
 * @path scripts/go_port/snapshot_manifest.ts
 * @description Writes the deterministic Phase 245 baseline manifest from tracked files, submodule SHAs and runtime versions.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/snapshot_manifest.json, exaix-dev-docs/completed/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/snapshot_manifest.ts [--allow-dirty] [--output=<path>]
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

/** A JSON value that the manifest hash accepts. */
export type TJsonValue = string | number | boolean | null | readonly TJsonValue[] | {
  readonly [key: string]: TJsonValue;
};

/** The deterministic baseline document. */
interface ISnapshotManifest {
  readonly schema_version: 1;
  readonly created_at: string;
  readonly content_hash: string;
  readonly parent: string;
  readonly submodules: Readonly<Record<string, string>>;
  readonly lockfiles: Readonly<Record<string, string>>;
  readonly runtime: { readonly deno: string; readonly go: string; readonly docker: string };
  readonly images: Readonly<Record<string, string>>;
  readonly scenarios: Readonly<Record<string, string>>;
  readonly fixtures: Readonly<Record<string, string>>;
  readonly dirty: boolean;
}

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", ".."));
const DEFAULT_OUTPUT = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "snapshot_manifest.json");
export const MAX_ENTRIES = 10_000;
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export function stable(value: TJsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hashes the normalized document. `created_at` and `content_hash` are excluded. */
export async function contentHash(value: TJsonValue): Promise<string> {
  const record = value as { readonly [key: string]: TJsonValue };
  const { created_at: _created, content_hash: _hash, ...rest } = record;
  return await sha256Hex(stable(rest as TJsonValue));
}

/** Refuses a dirty worktree unless the caller explicitly allows it. */
export function assertClean(status: string, allowDirty: boolean): void {
  if (!allowDirty && status.trim() !== "") {
    throw new Error(`dirty worktree: commit or stash the changes before recording the manifest\n${status.trim()}`);
  }
}

/** Parses `git submodule status --recursive` into path → SHA. */
export function parseSubmodules(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^[ +-]?([0-9a-f]{40})\s+(\S+)/);
    if (match) result[match[2]] = match[1];
  }
  return result;
}

/** Rejects a manifest beyond the documented inventory limits. */
export function assertBounds(entries: number, bytes: number): void {
  if (entries > MAX_ENTRIES) throw new Error(`manifest entries ${entries} exceed ${MAX_ENTRIES}`);
  if (bytes > MAX_MANIFEST_BYTES) throw new Error(`manifest bytes ${bytes} exceed ${MAX_MANIFEST_BYTES}`);
}

/** Keeps tracked source paths and drops local state, secrets and generated evidence. */
export function selectTrackedPaths(paths: readonly string[]): string[] {
  return paths.filter((path) =>
    path !== "" &&
    !path.startsWith(".exa/") &&
    !path.startsWith("exaix-dev-docs/evidence/") &&
    !path.split("/").includes(".env") &&
    !path.endsWith("/.env")
  );
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await new Deno.Command("git", {
    args: ["-C", cwd, ...args],
    env: { LD_LIBRARY_PATH: "" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
  return new TextDecoder().decode(result.stdout).trim();
}

async function version(command: string, args: readonly string[]): Promise<string> {
  try {
    const result = await new Deno.Command(command, { args: [...args], stdout: "piped", stderr: "null" }).output();
    return result.success ? new TextDecoder().decode(result.stdout).split("\n")[0].trim() : "absent";
  } catch {
    return "absent";
  }
}

async function hashFiles(root: string, paths: readonly string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const path of paths) result[path] = await sha256Hex(await Deno.readFile(join(root, path)));
  return result;
}

function isScenario(path: string): boolean {
  return path.startsWith("tests/scenario_framework/scenarios/") && /\.ya?ml$/.test(path);
}

function isFixture(path: string): boolean {
  return path.startsWith("tests/scenario_framework/fixtures/") || path.startsWith("tests/fixtures/");
}

function isLockfile(path: string): boolean {
  return path.endsWith("deno.lock") || path.endsWith("package-lock.json");
}

/** Builds the baseline manifest for a repository root. */
export async function createManifest(
  root: string,
  options: { readonly allowDirty?: boolean; readonly images?: readonly string[] } = {},
): Promise<ISnapshotManifest> {
  const status = await git(root, ["status", "--porcelain"]);
  assertClean(status, options.allowDirty ?? false);
  const parent = await git(root, ["rev-parse", "HEAD"]);
  const submodules = parseSubmodules(await git(root, ["submodule", "status", "--recursive"]));
  const tracked = selectTrackedPaths((await git(root, ["ls-files"])).split("\n"));
  const scenarios = await hashFiles(root, tracked.filter(isScenario));
  const fixtures = await hashFiles(root, tracked.filter(isFixture));
  const lockfiles = await hashFiles(root, tracked.filter(isLockfile));
  const images: Record<string, string> = {};
  for (const image of options.images ?? []) {
    images[image] = await version("docker", ["image", "inspect", "--format", "{{index .RepoDigests 0}}", image]);
  }
  const manifest: ISnapshotManifest = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    content_hash: "",
    parent,
    submodules,
    lockfiles,
    runtime: {
      deno: await version("deno", ["--version"]),
      go: await version("go", ["version"]),
      docker: await version("docker", ["version", "--format", "{{.Server.Version}}"]),
    },
    images,
    scenarios,
    fixtures,
    dirty: status.trim() !== "",
  };
  const body = { ...manifest, content_hash: "" };
  const bytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  const entries = Object.keys(submodules).length + Object.keys(lockfiles).length +
    Object.keys(scenarios).length + Object.keys(fixtures).length + Object.keys(images).length;
  assertBounds(entries, bytes);
  return { ...manifest, content_hash: await contentHash(body as TJsonValue) };
}

async function main(args: readonly string[]): Promise<number> {
  const outputArg = args.find((arg) => arg.startsWith("--output="));
  const output = outputArg === undefined ? DEFAULT_OUTPUT : resolve(outputArg.slice("--output=".length));
  const imageArgs = args.filter((arg) => arg.startsWith("--image=")).map((arg) => arg.slice("--image=".length));
  try {
    const manifest = await createManifest(REPO_ROOT, { allowDirty: args.includes("--allow-dirty"), images: imageArgs });
    await Deno.mkdir(dirname(output), { recursive: true });
    await Deno.writeTextFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`✅ wrote ${output} (${manifest.content_hash.slice(0, 12)})`);
    return 0;
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
