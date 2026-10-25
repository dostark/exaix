#!/usr/bin/env -S deno run -A
/**
 * @module InstallPortalPolicy
 * @path packages/lint-policy/src/tools/install_portal_policy.ts
 * @description Builds the Exaix portal lint policy directory with the engine's deno-policy command.
 * @architectural-layer Tooling
 * @dependencies [@std/flags, @std/path, @dostark/unslop-ts/deno-policy]
 * @related-files [packages/lint-policy/src/policy_config.ts, packages/testing/src/helpers/lint_policy.ts]
 *
 * Usage:
 *   deno run -A packages/lint-policy/src/tools/install_portal_policy.ts [--out <dir>]
 *
 * The installer reads the portal configuration of this package.
 * It writes <out>/unslop/ with the engine bundle, the catalog, the plugin entry,
 * the Deno config, and the manifest.
 * The default <out> is the repository lint directory, which Git ignores.
 */

import { parse } from "@std/flags";
import { fromFileUrl, join, resolve } from "@std/path";
import { buildDenoPolicy, type IDenoPolicyReport, type IEngineBundler } from "@dostark/unslop-ts/deno-policy";

const POLICY_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const REPO_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));

/** The policy directory name a check selects with its `policy` field. */
export const PORTAL_POLICY_NAME = "unslop";

/** The rule packs the portal policy loads, in plugin order. */
export const PORTAL_POLICY_PACKS: readonly string[] = ["typescript", "deno"];

/** The version 2 configuration this package owns. */
export const PORTAL_POLICY_CONFIG = join(POLICY_ROOT, "portal", "unslop.config.json");

const USAGE = "Usage: deno run -A packages/lint-policy/src/tools/install_portal_policy.ts [--out <dir>]";

/** Inputs of one portal policy installation. */
export interface IInstallPortalPolicyOptions {
  /** The directory that receives the policy subdirectory. */
  readonly out: string;
  /** A version 2 configuration path. Defaults to the portal configuration. */
  readonly config?: string;
  /** Engine bundler override for tests that do not lint. */
  readonly bundler?: IEngineBundler;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Builds `<out>/unslop/` from the portal configuration and returns the engine report. */
export async function installPortalPolicy(
  options: IInstallPortalPolicyOptions,
): Promise<IDenoPolicyReport> {
  return await buildDenoPolicy({
    config: options.config ?? PORTAL_POLICY_CONFIG,
    packs: [...PORTAL_POLICY_PACKS],
    out: join(resolve(options.out), PORTAL_POLICY_NAME),
    ...(options.bundler === undefined ? {} : { bundler: options.bundler }),
  });
}

/** Runs the installer command line and returns its exit code. */
async function main(argv: readonly string[]): Promise<number> {
  let flags: Record<string, unknown>;
  try {
    flags = parse([...argv], {
      string: ["out"],
      boolean: ["help"],
      alias: { h: "help" },
      default: { out: join(REPO_ROOT, "lint") },
    });
  } catch (error) {
    console.error(messageOf(error));
    return 2;
  }
  if (flags.help === true) {
    console.log(USAGE);
    return 0;
  }
  if (typeof flags.out !== "string" || flags.out.length === 0) {
    console.error("--out must name a directory");
    return 2;
  }
  try {
    const report = await installPortalPolicy({ out: flags.out });
    console.log(`installed the ${PORTAL_POLICY_NAME} policy directory at ${report.out}`);
    return 0;
  } catch (error) {
    console.error(messageOf(error));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
