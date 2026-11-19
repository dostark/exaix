#!/usr/bin/env -S deno run -A
/**
 * @module GoPortBenchmark
 * @path scripts/go_port/benchmark.ts
 * @description Records warm and cold CLI benchmarks for the Deno source, deno compile and a Go role slice.
 * @architectural-layer Tooling
 * @dependencies [@std/path]
 * @related-files [exaix-dev-docs/evidence/go-port/benchmarks.json, exaix-dev-docs/planning/phase-245-go-port-prerequisites.md]
 *
 * Usage:
 *   deno run -A scripts/go_port/benchmark.ts [--output=<path>]
 */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

/** The two benchmark conditions. */
type TCondition = "cold" | "warm";

/** One measured mode and condition. */
interface IBenchmarkMode {
  readonly mode: string;
  readonly condition: TCondition;
  readonly samples: readonly number[];
  readonly median_ms?: number;
  readonly p95_ms?: number;
  readonly max_rss_kb: number | null;
  readonly binary_bytes: number | null;
}

/** The benchmark evidence document. */
interface IBenchmarks {
  readonly host: string;
  readonly versions: Readonly<Record<string, string>>;
  readonly modes: readonly IBenchmarkMode[];
  readonly command: string;
  readonly build_flags: string;
  readonly unavailable: readonly string[];
}

/** The untrusted shape accepted by the validator. */
interface IBenchmarksInput {
  readonly host?: string;
  readonly versions?: Readonly<Record<string, string>>;
  readonly modes?: readonly {
    readonly mode?: string;
    readonly condition?: string;
    readonly samples?: readonly number[];
    readonly max_rss_kb?: number | null;
    readonly binary_bytes?: number | null;
  }[];
  readonly command?: string;
  readonly build_flags?: string;
  readonly unavailable?: readonly string[];
}

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", ".."));
const GO_ROOT = join(dirname(REPO_ROOT), "exaix-go");
const REPETITIONS = 5;
const COLD_IDLE_MS = 1_000;
const SOURCE_COMMAND = ["deno", "run", "-A", "apps/exactl/main.ts", "config", "show", "--output", "json"];

/** Returns median and p95 for a non-empty sample set. */
export function summarize(samples: readonly number[]): { median: number; p95: number } {
  if (samples.length === 0) throw new Error("empty sample set");
  const sorted = [...samples].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  return { median, p95 };
}

/** Reads the maximum RSS line from `/usr/bin/time -v` output. */
export function parseMaxRss(text: string): number | null {
  const match = text.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
  return match === null ? null : Number(match[1]);
}

/** Validates the benchmark document and returns an empty list when valid. */
export function validateBenchmarks(raw: IBenchmarksInput): string[] {
  const errors: string[] = [];
  if (typeof raw.host !== "string" || raw.host === "") errors.push("host");
  if (!Array.isArray(raw.modes) || raw.modes.length === 0) errors.push("modes: at least one");
  for (const mode of raw.modes ?? []) {
    if (typeof mode.mode !== "string" || mode.mode === "") errors.push("modes.mode");
    if (mode.condition !== "cold" && mode.condition !== "warm") errors.push("modes.condition");
    if (!Array.isArray(mode.samples) || mode.samples.length === 0) errors.push("modes.samples");
  }
  if (raw.unavailable !== undefined) {
    if (!Array.isArray(raw.unavailable) || raw.unavailable.some((item) => typeof item !== "string")) {
      errors.push("unavailable");
    }
  }
  if (errors.length > 0) throw new Error(`benchmarks: ${errors.join("; ")}`);
  return [];
}

async function version(command: string, args: readonly string[]): Promise<string> {
  try {
    const result = await new Deno.Command(command, { args: [...args], stdout: "piped", stderr: "null" }).output();
    return result.success ? new TextDecoder().decode(result.stdout).split("\n")[0].trim() : "absent";
  } catch {
    return "absent";
  }
}

interface IMeasurement {
  readonly ms: number;
  readonly rss_kb: number | null;
}

async function measure(
  command: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<IMeasurement> {
  const start = performance.now();
  const result = await new Deno.Command("/usr/bin/time", {
    args: ["-v", ...command],
    cwd,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(`${command.join(" ")} failed`);
  return { ms: performance.now() - start, rss_kb: parseMaxRss(new TextDecoder().decode(result.stderr)) };
}

async function sizes(path: string): Promise<number | null> {
  try {
    return (await Deno.stat(path)).size;
  } catch {
    return null;
  }
}

async function main(args: readonly string[]): Promise<number> {
  const outputArg = args.find((arg) => arg.startsWith("--output="));
  const output = outputArg === undefined
    ? join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "benchmarks.json")
    : resolve(outputArg.slice("--output=".length));
  const tmp = await Deno.makeTempDir({ prefix: "go_port_bench_" });
  try {
    const denoBinary = join(tmp, "exactl-src");
    const compile = await new Deno.Command("deno", {
      args: ["compile", "--allow-all", "--output", denoBinary, "apps/exactl/main.ts"],
      cwd: REPO_ROOT,
      env: { LD_LIBRARY_PATH: "" },
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!compile.success) throw new Error(`deno compile failed: ${new TextDecoder().decode(compile.stderr)}`);
    const goBinary = join(tmp, "exaix-go");
    const goBuild = await new Deno.Command("go", {
      args: ["build", "-o", goBinary, "./cmd/exaix"],
      cwd: GO_ROOT,
      env: { ...Deno.env.toObject(), GOWORK: "off", GOTOOLCHAIN: "local" },
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!goBuild.success) throw new Error(`go build failed: ${new TextDecoder().decode(goBuild.stderr)}`);
    const modes: IBenchmarkMode[] = [];
    const commands = [
      { mode: "deno-source", cmd: SOURCE_COMMAND, cwd: REPO_ROOT, binary: null as string | null },
      {
        mode: "deno-compiled",
        cmd: [denoBinary, "config", "show", "--output", "json"],
        cwd: REPO_ROOT,
        binary: denoBinary,
      },
      { mode: "go-slice", cmd: [goBinary, "exactl"], cwd: GO_ROOT, binary: goBinary },
    ];
    for (const entry of commands) {
      const cold = await measure(entry.cmd, entry.cwd);
      await new Promise((resolve) => setTimeout(resolve, COLD_IDLE_MS));
      const warm: number[] = [];
      let rss = cold.rss_kb;
      for (let index = 0; index < REPETITIONS; index += 1) {
        const sample = await measure(entry.cmd, entry.cwd);
        warm.push(Math.round(sample.ms));
        rss = sample.rss_kb;
      }
      const summary = summarize(warm);
      const binaryBytes = entry.binary === null ? null : await sizes(entry.binary);
      modes.push({
        mode: entry.mode,
        condition: "cold",
        samples: [Math.round(cold.ms)],
        max_rss_kb: cold.rss_kb,
        binary_bytes: binaryBytes,
      });
      modes.push({
        mode: entry.mode,
        condition: "warm",
        samples: warm,
        median_ms: summary.median,
        p95_ms: summary.p95,
        max_rss_kb: rss,
        binary_bytes: binaryBytes,
      });
    }
    const document: IBenchmarks = {
      host: `${Deno.build.os}/${Deno.build.arch}`,
      versions: { deno: await version("deno", ["--version"]), go: await version("go", ["version"]) },
      modes,
      command: SOURCE_COMMAND.join(" "),
      build_flags: "deno compile --allow-all; go build GOWORK=off GOTOOLCHAIN=local",
      unavailable: ["go-config-show"],
    };
    validateBenchmarks(document);
    await Deno.mkdir(dirname(output), { recursive: true });
    await Deno.writeTextFile(output, `${JSON.stringify(document, null, 2)}\n`);
    console.log(`✅ wrote ${output}`);
    return 0;
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
