#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL1ProcessReference
 * @path scripts/go_port/core_l1_process_reference.ts
 * @description Records one controlled child through the pinned SafeSubprocess with a synthetic environment and a relative cwd.
 * Usage: imported by core_l1_reference.ts.
 */
import { isAbsolute, join, normalize } from "@std/path";
import { runPinnedAdapter } from "./core_l1_adapter.ts";

/** One child request. The executable is an identity label, never a host path. */
export interface IProcessSpec {
  readonly id: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: readonly { readonly key: string; readonly value: string }[];
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

/** One normalized child observation. It holds no host path and no environment value. */
export interface IProcessObservation {
  readonly id: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment_keys: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exit_code: number;
  readonly category: string;
}

const MAX_ARGS = 256;
const MAX_ARG_BYTES = 4096;
const MAX_ARGV_BYTES = 64 * 1024;
const MAX_ENV_KEYS = 64;
const MAX_ENV_VALUE_BYTES = 4096;
const MAX_OUTPUT_BYTES = 1 << 20;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_ENV = /API_KEY|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY/i;
const INJECTION_PREFIXES = ["LD_", "DYLD_", "GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"];
const INJECTION_KEYS = [
  "BASH_ENV",
  "ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "PERL5LIB",
  "GEM_HOME",
  "GEM_PATH",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
];

export type TProcessRunner = (snapshot: string, spec: IProcessSpec) => Promise<IProcessObservation>;

const CHILD_SCRIPT = 'const keys = Object.keys(Deno.env.toObject()).sort().join(","); ' +
  'console.log("O".repeat(100)); console.error("E".repeat(100) + ":" + keys); Deno.exit(3);';

export const PROCESS_SPECS: readonly IProcessSpec[] = [
  {
    id: "process-request-outcomes",
    executable: "deno-eval-fixture",
    args: ["eval", "--allow-env", CHILD_SCRIPT],
    cwd: "work",
    environment: [{ key: "EXA_FIXTURE", value: "on" }],
    maxOutputBytes: 24,
    timeoutMs: 5000,
  },
];

function fail(field: string, category: string): never {
  throw new Error(`invalid process spec: ${field} ${category}`);
}

/** Validates one spec before any child runs. It reads no host path and no environment value. */
export function validateProcessSpec(spec: IProcessSpec): void {
  if (spec.executable.length === 0) fail("executable", "missing");
  if (spec.args.length > MAX_ARGS) fail("args", "too_many");
  let total = 0;
  for (const arg of spec.args) {
    if (arg.includes("\0") || new TextEncoder().encode(arg).length > MAX_ARG_BYTES) fail("args", "invalid_argument");
    total += new TextEncoder().encode(arg).length;
  }
  if (total > MAX_ARGV_BYTES) fail("args", "too_large");
  if (spec.cwd.includes("\\") || spec.cwd.includes("\0") || isAbsolute(spec.cwd)) fail("cwd", "invalid_path");
  const cwd = normalize(spec.cwd);
  if (cwd === ".." || cwd.startsWith("../")) fail("cwd", "invalid_path");
  if (spec.environment.length > MAX_ENV_KEYS) fail("environment", "too_many");
  const seen = new Set<string>();
  for (const entry of spec.environment) {
    if (!ENV_KEY.test(entry.key)) fail("environment", "invalid_key");
    if (SECRET_ENV.test(entry.key)) fail("environment", "forbidden_key");
    if (INJECTION_KEYS.includes(entry.key) || INJECTION_PREFIXES.some((prefix) => entry.key.startsWith(prefix))) {
      fail("environment", "forbidden_key");
    }
    if (new TextEncoder().encode(entry.value).length > MAX_ENV_VALUE_BYTES || entry.value.includes("\0")) {
      fail("environment", "invalid_value");
    }
    if (seen.has(entry.key)) fail("environment", "duplicate_key");
    seen.add(entry.key);
  }
  if (spec.maxOutputBytes <= 0 || spec.maxOutputBytes > MAX_OUTPUT_BYTES) fail("maxOutputBytes", "out_of_range");
  if (spec.timeoutMs <= 0 || spec.timeoutMs > MAX_TIMEOUT_MS) fail("timeoutMs", "out_of_range");
}

const ADAPTER = `const [root, requestPath] = Deno.args;
const spec = JSON.parse(await Deno.readTextFile(requestPath));
const { SafeSubprocess } = await import(new URL("file://" + root + "/packages/core/src/helpers/subprocess.ts").href);
const env = Object.fromEntries(spec.environment.map((entry) => [entry.key, entry.value]));
try {
  const result = await SafeSubprocess.run(spec.command, spec.args, {
    cwd: spec.cwd, env, clearEnv: true, timeoutMs: spec.timeoutMs, maxOutputChars: spec.maxOutputChars,
  });
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, kind: error?.constructor?.name ?? "Error" }));
}
`;

interface IAdapterResult {
  readonly ok: boolean;
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly kind?: string;
}

/** Runs the pinned SafeSubprocess in one fresh root and normalizes the result. */
export const pinnedProcessRunner: TProcessRunner = async (
  snapshot: string,
  spec: IProcessSpec,
): Promise<IProcessObservation> => {
  validateProcessSpec(spec);
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: `core-l1-${spec.id}-` }));
  try {
    await Deno.mkdir(join(root, spec.cwd), { recursive: true });
    const request = JSON.stringify({
      command: Deno.execPath(),
      args: spec.args,
      cwd: join(root, spec.cwd),
      environment: spec.environment,
      maxOutputChars: spec.maxOutputBytes,
      timeoutMs: spec.timeoutMs,
    });
    const output = await runPinnedAdapter(snapshot, ADAPTER, request, {}, ["--allow-run"]);
    const result = JSON.parse(output) as IAdapterResult;
    if (!result.ok || result.code === undefined || result.stdout === undefined || result.stderr === undefined) {
      throw new Error(`${spec.id}: the pinned child outcome is ${result.kind ?? "unknown"}`);
    }
    return {
      id: spec.id,
      argv: spec.args,
      cwd: normalize(spec.cwd),
      environment_keys: [...spec.environment.map((entry) => entry.key)].sort(),
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.code,
      category: result.code === 0 ? "ok" : "failed",
    };
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
};

/** Records every spec through the runner. A second run produces the same bytes. */
export async function recordProcessCases(
  snapshot: string,
  runner: TProcessRunner,
): Promise<{ id: string; input: string; observation: string }[]> {
  const recorded: { id: string; input: string; observation: string }[] = [];
  for (const spec of PROCESS_SPECS) {
    validateProcessSpec(spec);
    const observation = await runner(snapshot, spec);
    recorded.push({
      id: spec.id,
      input: `${JSON.stringify(spec, null, 2)}\n`,
      observation: `${JSON.stringify(observation, null, 2)}\n`,
    });
  }
  return recorded;
}
