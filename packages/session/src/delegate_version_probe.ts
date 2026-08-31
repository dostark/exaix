/**
 * @module DelegateVersionProbe
 * @path packages/session/src/delegate_version_probe.ts
 * @description Phase 128 Step 1 — version probe for delegate tools (OpenCode,
 *   Claude Code). Runs `<bin> --version`, parses the first semver-like token,
 *   compares against the minimum constant, and returns a result with an optional
 *   warning message. The spawn function is injectable for deterministic testing.
 * @architectural-layer Services
 * @dependencies [@exaix/core]
 * @related-files [packages/session/src/supervised_launch.ts, packages/core/src/types/constants.ts]
 */

/**
 * Result of a delegate version probe.
 * `supported` is true when the parsed version >= minimum.
 * `warning` is set when the version check fails or the version is unsupported.
 */
export interface IDelegateVersionResult {
  version: string;
  supported: boolean;
  /** Human-readable warning when unsupported or unparseable; undefined when fine. */
  warning?: string;
}

/** Injectable spawn dependency — returns the raw output of `<bin> --version`. */
export interface IDelegateVersionProbeDeps {
  spawnVersion?: (bin: string) => Promise<{ success: boolean; stdout: Uint8Array; stderr: Uint8Array }>;
}

const VERSION_SEMVER_PATTERN = /(\d+\.\d+\.\d+)/;

/** Returns [0, 0, 0] on failure so the comparison naturally reports "unsupported". */
function parseSemver(raw: string): [number, number, number] {
  const trimmed = raw.trim();
  const match = trimmed.match(VERSION_SEMVER_PATTERN);
  if (!match) return [0, 0, 0];
  const parts = match[1].split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return [0, 0, 0];
  return parts as [number, number, number];
}

/**
 * Compare two semver tuples. Returns true when `actual >= minimum`.
 */
function semverGte(actual: [number, number, number], minimum: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (actual[i] > minimum[i]) return true;
    if (actual[i] < minimum[i]) return false;
  }
  return true; // exact match
}

export async function probeDelegateVersion(
  bin: string,
  minimumVersion: string,
  deps: IDelegateVersionProbeDeps = {},
): Promise<IDelegateVersionResult> {
  const spawn = deps.spawnVersion ?? defaultSpawnVersion;

  let output: { success: boolean; stdout: Uint8Array; stderr: Uint8Array };
  try {
    output = await spawn(bin);
  } catch {
    return {
      version: "unknown",
      supported: false,
      warning: `[delegate_version] Could not probe '${bin} --version' (binary not found or not executable).`,
    };
  }

  const raw = new TextDecoder().decode(output.stdout).trim() ||
    new TextDecoder().decode(output.stderr).trim();

  if (!raw) {
    return {
      version: "unknown",
      supported: false,
      warning: `[delegate_version] '${bin} --version' produced no output.`,
    };
  }

  const version = parseSemver(raw);
  if (version[0] === 0 && version[1] === 0 && version[2] === 0) {
    return {
      version: raw.split("\n")[0],
      supported: false,
      warning: `[delegate_version] Could not parse version from '${bin} --version' output: "${raw.split("\n")[0]}".`,
    };
  }

  const versionStr = `${version[0]}.${version[1]}.${version[2]}`;
  const minimum = parseSemver(minimumVersion);

  if (!semverGte(version, minimum)) {
    return {
      version: versionStr,
      supported: false,
      warning:
        `[delegate_version] '${bin}' version ${versionStr} is below the minimum recommended version ${minimumVersion}. Upgrade to benefit from permission hardening.`,
    };
  }

  return { version: versionStr, supported: true };
}

/** Default spawn implementation using Deno.Command. */
export function defaultSpawnVersion(
  bin: string,
): Promise<{ success: boolean; stdout: Uint8Array; stderr: Uint8Array }> {
  const cmd = new Deno.Command(bin, { args: ["--version"], stdout: "piped", stderr: "piped" });
  return cmd.output();
}
