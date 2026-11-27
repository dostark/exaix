#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL1Adapter
 * @path scripts/go_port/core_l1_adapter.ts
 * @description Runs one adapter script inside a verified pinned snapshot with an explicit environment and returns its output.
 * Usage: imported by the core-l1 reference recorders.
 */
import { join, toFileUrl } from "@std/path";

const FORWARDED_ENV = ["HOME", "PATH", "DENO_DIR", "XDG_CACHE_HOME"];

function forwardedEnv(extra: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = { DENO_NO_UPDATE_CHECK: "1", LD_LIBRARY_PATH: "" };
  for (const name of FORWARDED_ENV) {
    const value = Deno.env.get(name);
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

/** Writes the adapter and its request into a scratch directory, runs it in the snapshot and returns standard output. */
export async function runPinnedAdapter(
  snapshot: string,
  source: string,
  request: string,
  extraEnv: Readonly<Record<string, string>>,
  extraPermissions: readonly string[] = [],
): Promise<string> {
  const scratch = await Deno.makeTempDir({ prefix: "core-l1-adapter-" });
  try {
    const adapter = join(scratch, "adapter.ts");
    const requestPath = join(scratch, "request.json");
    await Deno.writeTextFile(adapter, source);
    await Deno.writeTextFile(requestPath, request);
    const result = await new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-ffi",
        ...extraPermissions,
        "--config",
        join(snapshot, "deno.json"),
        "--frozen",
        "--lock",
        join(snapshot, "deno.lock"),
        toFileUrl(adapter).href,
        snapshot,
        requestPath,
      ],
      cwd: snapshot,
      clearEnv: true,
      env: forwardedEnv(extraEnv),
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      throw new Error(new TextDecoder().decode(result.stderr).trim() || "core-l1 reference adapter failed");
    }
    return new TextDecoder().decode(result.stdout);
  } finally {
    await Deno.remove(scratch, { recursive: true }).catch(() => {});
  }
}
