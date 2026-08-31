#!/usr/bin/env -S deno run --allow-all
/**
 * @module RunJailed
 * @path tests/scenario_framework/scripts/run_jailed.ts
 * @description Framework-owned wrapper that runs one command inside the hardened eval-jail
 *   container via `buildJailLaunch` (`matrix_expander.ts`) — the exact same shape bare-cell
 *   matrix launches and the external_bench_task template already use. Exists so a scenario
 *   step reads as `run_jailed.ts --mount-source ... --bin opencode -- run --format json ...`
 *   through a declarative `run-script` step (command: deno) instead of a raw `docker run ...`
 *   invocation baked into the persisted scenario YAML — GitHub issue #4 /
 *   `deno task check:scenario-declarative`'s `inline-script` and `test-run` categories.
 *   Also refreshes a disposable, stable credential copy for `--credential-bin` immediately
 *   before launching (folding what was previously `scenario_templates.ts`'s separate
 *   `stage-<bin>-credentials` step — the `sandbox-setup` category — into this same
 *   invocation, since staging only ever existed to feed this launch; refreshing here keeps
 *   the "always live, never a stale generation-time snapshot" property the separate step had).
 * @dependencies [tests/scenario_framework/runner/matrix_expander.ts]
 * @related-files [tests/scenario_framework/runner/scenario_templates.ts, tests/scenario_framework/tests/unit/run_jailed_test.ts]
 */

import { dirname, join } from "@std/path";
import { buildJailLaunch, CREDENTIAL_STORES } from "../runner/matrix_expander.ts";

export interface IRunJailedOptions {
  mountSource: string;
  mountDest: string;
  workdir: string;
  extraMounts: string[];
  credentialBin?: string;
  credentialStagingDir?: string;
  bin: string;
  innerArgs: string[];
}

const KNOWN_FLAGS = new Set([
  "--mount-source",
  "--mount-dest",
  "--workdir",
  "--extra-mount",
  "--credential-bin",
  "--credential-staging-dir",
  "--bin",
]);

// Everything after a bare `--` is the inner command's args, taken verbatim and never
// re-parsed as flags, so an inner arg that happens to start with `-` passes through unmolested.
export function parseRunJailedArgs(argv: string[]): IRunJailedOptions {
  const sepIndex = argv.indexOf("--");
  if (sepIndex === -1) {
    throw new Error("run_jailed.ts requires a '--' separator before the inner command's args");
  }
  const flagArgs = argv.slice(0, sepIndex);
  const innerArgs = argv.slice(sepIndex + 1);

  const extraMounts: string[] = [];
  const values = new Map<string, string>();

  for (let i = 0; i < flagArgs.length; i++) {
    const flag = flagArgs[i];
    if (!KNOWN_FLAGS.has(flag)) {
      throw new Error(`run_jailed.ts: unknown flag "${flag}"`);
    }
    const value = flagArgs[++i];
    if (value === undefined) {
      throw new Error(`run_jailed.ts: flag "${flag}" is missing its value`);
    }
    if (flag === "--extra-mount") {
      extraMounts.push(value);
    } else {
      values.set(flag, value);
    }
  }

  const mountSource = values.get("--mount-source");
  const mountDest = values.get("--mount-dest");
  const workdir = values.get("--workdir");
  const bin = values.get("--bin");
  const credentialBin = values.get("--credential-bin");
  const credentialStagingDir = values.get("--credential-staging-dir");

  if (!mountSource) throw new Error("run_jailed.ts requires --mount-source");
  if (!mountDest) throw new Error("run_jailed.ts requires --mount-dest");
  if (!workdir) throw new Error("run_jailed.ts requires --workdir");
  if (!bin) throw new Error("run_jailed.ts requires --bin");
  if (credentialBin && !credentialStagingDir) {
    throw new Error("run_jailed.ts requires --credential-staging-dir when --credential-bin is set");
  }

  return { mountSource, mountDest, workdir, extraMounts, credentialBin, credentialStagingDir, bin, innerArgs };
}

// Copies the live credential into a disposable staging dir rather than mounting it directly,
// and returns [] instead of throwing when it's unavailable, matching `matrix_expander.ts`'s
// own `resolveCredentialMounts` degradation to an unauthenticated jailed run.
export async function stageCredentials(credentialBin: string, stagingDir: string): Promise<string[]> {
  const store = CREDENTIAL_STORES[credentialBin];
  const hostHome = Deno.env.get("HOME");
  if (!store || !hostHome) return [];
  try {
    const liveCredsPath = join(hostHome, store.liveRelPath);
    const stagedFile = join(stagingDir, store.stagedFileRelPath);
    await Deno.mkdir(dirname(stagedFile), { recursive: true });
    await Deno.copyFile(liveCredsPath, stagedFile);
    return ["--mount", `type=bind,src=${stagingDir},dst=/tmp/${store.stagedDirRelPath}`];
  } catch {
    return [];
  }
}

/** Exported separately from `if (import.meta.main)` for direct unit testing without a real docker daemon. */
export async function buildRunJailedLaunch(options: IRunJailedOptions): Promise<{ bin: string; args: string[] }> {
  const credentialMountArgs = options.credentialBin && options.credentialStagingDir
    ? await stageCredentials(options.credentialBin, options.credentialStagingDir)
    : [];
  return buildJailLaunch({ bin: options.bin, args: options.innerArgs }, {
    mountSource: options.mountSource,
    mountDest: options.mountDest,
    workdir: options.workdir,
    extraMounts: options.extraMounts,
    credentialMountArgs,
  });
}

if (import.meta.main) {
  const options = parseRunJailedArgs(Deno.args);
  const launch = await buildRunJailedLaunch(options);
  const command = new Deno.Command(launch.bin, {
    args: launch.args,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.output();
  Deno.exit(status.code);
}
