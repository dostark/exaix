#!/usr/bin/env -S deno run -A
/**
 * @module BackupRepo
 * @path scripts/backup_repo.ts
 * @description Full backup of the Exaix repository — git history, current branch, and all
 * submodules (exaix-dev-docs, exaix-enterprise, exaix-team) — cloned to a target destination.
 *
 * The clone is fully offline: submodule URLs in .gitmodules are overridden with the local
 * submodule checkouts as sources, so no network or SSH access is required. The backup is
 * self-contained (own .git) and can later be used as a source for `git clone`/restore.
 *
 * Usage:
 *   deno run -A scripts/backup_repo.ts --destination <path> [options]
 *
 * Options:
 *   --destination <path>  Required. Output directory for the backup (must be empty/absent).
 *   --branch <name>       Branch to check out in the backup. Default: "main".
 *   --no-verify           Skip the post-clone SHA verification against the source repo.
 */

import { parse } from "@std/flags";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const DEFAULT_BACKUP_BRANCH = "main";

/** Parses .gitmodules submodule sections into `{ name, path, url }` records; returns [] if the file is absent. */
export async function parseGitmodules(repoRoot: string): Promise<
  Array<{
    name: string;
    path: string;
    url: string;
  }>
> {
  const gitmodulesPath = join(repoRoot, ".gitmodules");
  const text = await Deno.readTextFile(gitmodulesPath).catch(() => "");
  const submodules: Array<{ name: string; path: string; url: string }> = [];
  let current: { name: string; path: string; url: string } | null = null;
  for (const line of text.split("\n")) {
    const section = /^\[submodule "([^"]+)"\]$/.exec(line.trim());
    if (section) {
      current = { name: section[1], path: "", url: "" };
      submodules.push(current);
      continue;
    }
    if (!current) continue;
    const pathMatch = /^path\s*=\s*(.+)$/.exec(line.trim());
    const urlMatch = /^url\s*=\s*(.+)$/.exec(line.trim());
    if (pathMatch) current.path = pathMatch[1];
    if (urlMatch) current.url = urlMatch[1];
  }
  return submodules;
}

async function run(cmd: string[], options: { cwd?: string } = {}): Promise<boolean> {
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: options.cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await command.spawn().status).success;
}

/** First column (SHA prefix) of each line of `git submodule status` output. */
async function submoduleShas(repoPath: string): Promise<string[]> {
  const command = new Deno.Command("git", {
    args: ["submodule", "status"],
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout, stderr, success } = await command.spawn().output();
  if (!success) {
    throw new Error(`git submodule status failed in ${repoPath}: ${new TextDecoder().decode(stderr)}`);
  }
  return new TextDecoder()
    .decode(stdout)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim().split(/\s+/)[0].replace(/^-/, ""));
}

/** Clone repoRoot into dest (full history), then populate submodules from local sources. */
export async function backupRepo(
  repoRoot: string,
  dest: string,
  options: { branch?: string; verify?: boolean },
): Promise<void> {
  const branch = options.branch ?? DEFAULT_BACKUP_BRANCH;
  const verify = options.verify ?? true;

  if (await Deno.stat(dest).then((s) => s.isDirectory).catch(() => false)) {
    const entries = await Array.fromAsync(Deno.readDir(dest));
    if (entries.length > 0) {
      throw new Error(`Destination is not empty: ${dest}`);
    }
  }

  console.log(`Backing up ${repoRoot} -> ${dest} (branch: ${branch})`);
  // A `--no-checkout` clone leaves the index empty, so submodule gitlinks are missing and
  // `git submodule update` no-ops, later failing on checkout. A normal clone keeps the
  // index populated so submodule update works.
  if (!await run(["git", "clone", "--no-hardlinks", "-b", branch, repoRoot, dest])) {
    throw new Error("git clone failed");
  }

  const submodules = await parseGitmodules(repoRoot);
  if (submodules.length > 0) {
    if (!await run(["git", "submodule", "init"], { cwd: dest })) {
      throw new Error("git submodule init failed");
    }
    for (const sub of submodules) {
      const localSource = join(repoRoot, sub.path);
      console.log(`Submodule ${sub.name}: overriding URL with local source ${localSource}`);
      if (!await run(["git", "config", `submodule.${sub.name}.url`, localSource], { cwd: dest })) {
        throw new Error(`git config failed for submodule ${sub.name}`);
      }
    }
    // `-c protocol.file.allow=always` is required: git blocks local-path submodule
    // clones by default (CVE-2022-39253 hardening), and we clone from local checkouts.
    if (!await run(["git", "-c", "protocol.file.allow=always", "submodule", "update", "--checkout"], { cwd: dest })) {
      throw new Error("git submodule update failed");
    }
  }

  // File mode bits do not survive on some filesystems (e.g. Windows drvfs mounts).
  await run(["git", "config", "core.filemode", "false"], { cwd: dest });

  if (verify) {
    const sourceShas = submodules.length > 0 ? await submoduleShas(repoRoot) : [];
    const backupShas = submodules.length > 0 ? await submoduleShas(dest) : [];
    if (JSON.stringify(sourceShas) !== JSON.stringify(backupShas)) {
      throw new Error(
        `Submodule SHA mismatch:\n  source: ${sourceShas.join(", ")}\n  backup: ${backupShas.join(", ")}`,
      );
    }
    console.log(`Verified ${sourceShas.length} submodule(s) at matching SHAs.`);
  }

  console.log(`\nBackup complete at: ${dest}`);
  console.log("Restore with: git clone <backup> <new-worktree>");
}

async function main() {
  const flags = parse(Deno.args, {
    string: ["destination", "branch"],
    boolean: ["no-verify"],
    alias: { destination: "d", branch: "b", "no-verify": "v" },
  });
  if (!flags.destination) {
    console.error("Usage: deno run -A scripts/backup_repo.ts --destination <path> [--branch <name>] [--no-verify]");
    Deno.exit(1);
  }

  const repoRoot = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
  const dest = resolve(flags.destination);
  await backupRepo(repoRoot, dest, {
    branch: flags.branch,
    verify: !flags["no-verify"],
  });
}

if (import.meta.main) {
  await main();
}
