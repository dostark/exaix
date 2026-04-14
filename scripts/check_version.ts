#!/usr/bin/env -S deno run -A
/**
 * @module CheckVersion
 * @path scripts/check_version.ts
 * @description Version observer and commit gatekeeper for Exaix.
 *
 * Decision logic:
 *   - If any Minor Bump Trigger file is staged/changed → bump WORKSPACE_SCHEMA_VERSION MINOR.
 *   - If date has advanced since last bump → bump BINARY_VERSION PATCH.
 *   - If nothing changed → exit 0 with no modifications.
 *
 * Usage:
 *   deno run -A scripts/check_version.ts              # pre-commit: inspect --cached diff
 *   deno run -A scripts/check_version.ts --dry-run    # print without writing
 *   deno run -A scripts/check_version.ts --ci         # CI mode: inspect HEAD~1 diff
 *   deno run -A scripts/check_version.ts --force-patch # always bump BINARY_VERSION PATCH
 */

// ---------------------------------------------------------------------------
// Exported Types (must be at top per code style)
// ---------------------------------------------------------------------------

export interface ISemVer {
  major: number;
  minor: number;
  patch: number;
}

export interface Classification {
  requiresMinor: boolean;
}

export interface VersionConstants {
  BINARY_VERSION: string;
  WORKSPACE_SCHEMA_VERSION: string;
}

export interface VersionMeta {
  last_bump_date: string;
}

// ---------------------------------------------------------------------------
// Paths (relative to repo root)
// ---------------------------------------------------------------------------

import { join } from "@std/path";

const REPO_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const VERSION_FILE = join(REPO_ROOT, "src", "shared", "version.ts");
const META_FILE = join(REPO_ROOT, "src", "shared", ".version_meta.json");

// ---------------------------------------------------------------------------
// Minor-bump trigger file patterns
// ---------------------------------------------------------------------------

const MINOR_TRIGGER_PATTERNS: RegExp[] = [
  /^src\/shared\/schemas\/config\.ts$/,
  /^migrations\/.*\.sql$/,
  /^src\/services\/db\.ts$/,
  /^src\/shared\/constants\.ts$/,
  /^scripts\/setup_db\.ts$/,
];

// ---------------------------------------------------------------------------
// SemVer helpers (exported for unit testing)
// ---------------------------------------------------------------------------

export function parseSemVer(v: string): ISemVer {
  const parts = v.split(".");
  if (parts.length !== 3) throw new Error(`Invalid SemVer: "${v}"`);
  const [major, minor, patch] = parts.map((p) => {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0) throw new Error(`Invalid SemVer segment "${p}" in "${v}"`);
    return n;
  });
  return { major, minor, patch };
}

export function formatSemVer({ major, minor, patch }: ISemVer): string {
  return `${major}.${minor}.${patch}`;
}

export function bumpPatch(v: string): string {
  const sv = parseSemVer(v);
  return formatSemVer({ ...sv, patch: sv.patch + 1 });
}

export function bumpMinor(v: string): string {
  const sv = parseSemVer(v);
  return formatSemVer({ major: sv.major, minor: sv.minor + 1, patch: 0 });
}

// ---------------------------------------------------------------------------
// File classification (exported for unit testing)
// ---------------------------------------------------------------------------

export function classifyChanges(files: string[]): Classification {
  const requiresMinor = files.some((f) => MINOR_TRIGGER_PATTERNS.some((re) => re.test(f)));
  return { requiresMinor };
}

// ---------------------------------------------------------------------------
// version.ts I/O (exported for unit testing)
// ---------------------------------------------------------------------------

export function readVersionFile(path: string = VERSION_FILE): VersionConstants {
  const text = Deno.readTextFileSync(path);
  const bvMatch = text.match(/export const BINARY_VERSION\s*=\s*"([^"]+)"/);
  const wsvMatch = text.match(/export const WORKSPACE_SCHEMA_VERSION\s*=\s*"([^"]+)"/);
  if (!bvMatch || !wsvMatch) {
    throw new Error(`Could not parse version constants from ${path}`);
  }
  return {
    BINARY_VERSION: bvMatch[1],
    WORKSPACE_SCHEMA_VERSION: wsvMatch[1],
  };
}

export function writeVersionFile(
  bv: string,
  wsv: string,
  path: string = VERSION_FILE,
): void {
  let text = Deno.readTextFileSync(path);
  text = text.replace(
    /export const BINARY_VERSION\s*=\s*"[^"]+"/,
    `export const BINARY_VERSION = "${bv}"`,
  );
  text = text.replace(
    /export const WORKSPACE_SCHEMA_VERSION\s*=\s*"[^"]+"/,
    `export const WORKSPACE_SCHEMA_VERSION = "${wsv}"`,
  );
  Deno.writeTextFileSync(path, text);
}

// ---------------------------------------------------------------------------
// .version_meta.json I/O
// ---------------------------------------------------------------------------

export function readMetaFile(path: string = META_FILE): VersionMeta {
  return JSON.parse(Deno.readTextFileSync(path)) as VersionMeta;
}

export function writeMetaFile(date: string, path: string = META_FILE): void {
  Deno.writeTextFileSync(path, JSON.stringify({ last_bump_date: date }, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function runGit(...args: string[]): Promise<string> {
  const cmd = new Deno.Command("git", { args, stdout: "piped", stderr: "piped" });
  const { stdout } = await cmd.output();
  return new TextDecoder().decode(stdout).trim();
}

export async function getStagedFiles(): Promise<string[]> {
  const out = await runGit("diff", "--cached", "--name-only");
  return out.split("\n").filter(Boolean);
}

export async function getCiFiles(): Promise<string[]> {
  const out = await runGit("diff", "HEAD~1", "--name-only");
  return out.split("\n").filter(Boolean);
}

async function stageVersionFiles(): Promise<void> {
  const cmd = new Deno.Command("git", {
    args: ["add", "src/shared/version.ts", "src/shared/.version_meta.json"],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  if (code !== 0) throw new Error("Failed to stage version files");
}

// ---------------------------------------------------------------------------
// Today's ISO date
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().substring(0, 10);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = Deno.args;
  const dryRun = args.includes("--dry-run");
  const ciMode = args.includes("--ci");
  const forcePatch = args.includes("--force-patch");

  const today = todayIso();
  const meta = readMetaFile();
  const current = readVersionFile();

  const changedFiles = ciMode ? await getCiFiles() : await getStagedFiles();
  const { requiresMinor } = classifyChanges(changedFiles);
  const patchTrigger = forcePatch || today !== meta.last_bump_date;

  let newBv = current.BINARY_VERSION;
  let newWsv = current.WORKSPACE_SCHEMA_VERSION;
  let bumped = false;

  if (requiresMinor) {
    newWsv = bumpMinor(current.WORKSPACE_SCHEMA_VERSION);
    bumped = true;
    console.log(
      `📦 Minor workspace schema bump required: ${current.WORKSPACE_SCHEMA_VERSION} → ${newWsv}`,
    );
  }

  if (patchTrigger) {
    newBv = bumpPatch(current.BINARY_VERSION);
    bumped = true;
    console.log(`🔢 Patch bump: ${current.BINARY_VERSION} → ${newBv} (date: ${today})`);
  }

  if (!bumped) {
    console.log("✅ Version is current. No bump needed.");
    return;
  }

  if (dryRun) {
    console.log(`\n[dry-run] Would write:`);
    console.log(`  BINARY_VERSION          = "${newBv}"`);
    console.log(`  WORKSPACE_SCHEMA_VERSION = "${newWsv}"`);
    console.log(`  last_bump_date          = "${today}"`);
    return;
  }

  writeVersionFile(newBv, newWsv);
  writeMetaFile(today);
  await stageVersionFiles();
  console.log(`✅ Version files updated and staged.`);
}

// Only run when executed directly (not imported by tests)
if (import.meta.main) {
  main().catch((e) => {
    console.error("check_version error:", e.message);
    Deno.exit(1);
  });
}
