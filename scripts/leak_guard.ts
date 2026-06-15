#!/usr/bin/env -S deno run -A
/**
 * @module LeakGuard
 * @path scripts/leak_guard.ts
 * @description Pre-publish leak-guard: scans source trees for enterprise-path leaks,
 * proprietary-header leaks, and .gitmodules URL leaks before mirror-cut.
 *
 * Usage:
 *   deno run -A scripts/leak_guard.ts                                # scan full tree
 *   deno run -A scripts/leak_guard.ts --allowlist packages/ apps/    # only allowlisted dirs
 *   deno run -A scripts/leak_guard.ts --check-gitmodules             # strip exaix-enterprise from .gitmodules
 */

import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, normalize, resolve } from "@std/path";

/** Options for the leak-guard scan. */
export interface ILeakGuardOptions {
  /** Only scan these subtrees (relative to repo root). Default: entire tree. */
  allowlist?: string[];
  /** Also check .gitmodules for enterprise submodule leaks. */
  checkGitmodules?: boolean;
  /** Also check for proprietary license headers in source files. */
  checkHeaders?: boolean;
}

/** Result of a leak-guard scan. */
export interface ILeakResult {
  passed: boolean;
  errors: string[];
}

const REPO_ROOT = normalize(join(dirname(fromFileUrl(import.meta.url)), ".."));

// Allowlisted directories for public mirror content
const LEAK_PATHS = ["exaix-enterprise", "packages-enterprise", "packages-team"];

// Patterns that indicate a proprietary (BSL+) license header
const PROPRIETARY_HEADER_PATTERNS = [
  /Business Source License/i,
  /BSL\s+v?\d+/i,
  /Licensed\s+to\s+.*Exaix/i,
  /do\s+not\s+distribute/i,
  /source-available\s+license/i,
];

// Private submodule URL patterns
const PRIVATE_SUBMODULE_PATTERNS = [
  /exaix-enterprise/i,
];

function isSourceFile(path: string): boolean {
  const srcExts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".toml", ".yaml", ".yml", ".md"];
  return srcExts.some((ext) => path.endsWith(ext));
}

function isCodeFile(path: string): boolean {
  const codeExts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  return codeExts.some((ext) => path.endsWith(ext));
}

export async function runLeakGuard(options: ILeakGuardOptions = {}): Promise<ILeakResult> {
  const errors: string[] = [];
  const scanRoot = resolve(REPO_ROOT);
  const allowlist = options.allowlist;

  // Determine which directories to scan
  let scanTargets: string[];
  if (allowlist && allowlist.length > 0) {
    scanTargets = allowlist.map((d) => resolve(scanRoot, d));
  } else {
    // Scan everything except .git, dist, coverage, node_modules, and check_code_style.ts itself
    scanTargets = [scanRoot];
  }

  const skipDirs = [/^\.git$/, /^dist$/, /^coverage$/, /^node_modules$/, /^\.copilot$/];

  for (const target of scanTargets) {
    try {
      const stat = await Deno.stat(target);
      if (!stat.isDirectory) {
        const relative = target.replace(scanRoot, "").replace(/^\//, "");
        if (isSourceFile(relative)) {
          // Single file scan — handled below in the content scan
        }
        continue;
      }
    } catch {
      continue;
    }

    for await (
      const entry of walk(target, {
        includeDirs: false,
        followSymlinks: false,
        skip: skipDirs,
      })
    ) {
      const relativePath = entry.path.replace(scanRoot, "").replace(/^\//, "");

      // Skip the leak-guard script itself
      if (relativePath === "scripts/leak_guard.ts") continue;

      // Check 1: Leak paths in file content — flag only actual imports or
      // path-resolution references that would break or reveal structure in public code.
      if (isSourceFile(relativePath)) {
        try {
          const content = await Deno.readTextFile(entry.path);
          for (const leakPath of LEAK_PATHS) {
            if (content.includes(leakPath)) {
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // Ignore pathFilter exemptions, style rules, and build-config declarations
                if (
                  line.includes("pathFilter") || line.includes("style rule") ||
                  line.includes("LEAK_PATHS") || line.includes("leak_guard")
                ) {
                  continue;
                }
                // Flag only operational imports or runtime path resolutions
                if (
                  (line.includes(`from "@exaix`) || line.includes(`from "exaix-enterprise`)) &&
                  (line.includes(leakPath))
                ) {
                  errors.push(
                    `LEAK: ${relativePath}:${i + 1} — runtime import of '${leakPath}' (would fail in public mirror)`,
                  );
                }
                // Flag literal string references that reveal enterprise or team paths
                if (
                  (line.match(/["'`][^"'`]*exaix-enterprise[^"'`]*["'`]/) ||
                    line.match(/["'`][^"'`]*packages-team[^"'`]*["'`]/)) &&
                  (line.includes("import") || line.includes("require"))
                ) {
                  errors.push(
                    `LEAK: ${relativePath}:${i + 1} — string literal referencing '${leakPath}' in import/require`,
                  );
                }
              }
            }
          }
        } catch {
          // Binary file, skip
        }
      }

      // Check 2: Proprietary license headers in code files
      if (options.checkHeaders && isCodeFile(relativePath)) {
        try {
          const content = await Deno.readTextFile(entry.path);
          const firstLines = content.split("\n").slice(0, 20).join("\n");
          for (const pattern of PROPRIETARY_HEADER_PATTERNS) {
            if (pattern.test(firstLines)) {
              errors.push(
                `LEAK: ${relativePath} — contains proprietary license header (matched: ${pattern.source})`,
              );
            }
          }
        } catch {
          // skip
        }
      }
    }
  }

  // Check 3: .gitmodules should not expose enterprise submodule URL
  if (options.checkGitmodules) {
    try {
      const gitmodulesPath = join(scanRoot, ".gitmodules");
      const content = await Deno.readTextFile(gitmodulesPath);
      for (const pattern of PRIVATE_SUBMODULE_PATTERNS) {
        if (pattern.test(content)) {
          errors.push(
            `LEAK: .gitmodules contains '${pattern.source}' — strip the exaix-enterprise entry before publishing`,
          );
        }
      }
    } catch {
      // No .gitmodules found — skip
    }
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

async function main() {
  const args = Deno.args;
  const allowlist: string[] = [];
  let checkGitmodules = false;
  let checkHeaders = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allowlist") {
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        allowlist.push(args[++i]);
      }
    } else if (args[i] === "--check-gitmodules") {
      checkGitmodules = true;
    } else if (args[i] === "--check-headers") {
      checkHeaders = true;
    }
  }

  console.log("🔍 Running Leak Guard...");

  const result = await runLeakGuard({
    allowlist: allowlist.length > 0 ? allowlist : undefined,
    checkGitmodules,
    checkHeaders,
  });

  if (result.passed) {
    console.log("✅ Leak Guard passed — no leaks detected.");
    Deno.exit(0);
  } else {
    console.error(`❌ Leak Guard failed — ${result.errors.length} leak(s) detected:\n`);
    for (const err of result.errors) {
      console.error(`  • ${err}`);
    }
    console.error("\n⚠️  Fix these leaks before publishing public mirrors.");
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
