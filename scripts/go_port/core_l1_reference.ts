#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL1Reference
 * @path scripts/go_port/core_l1_reference.ts
 * @description Records the pinned ConfigService observations for the core-l1 configuration cases in real temporary roots and writes them with a digest manifest for the Go replay tests.
 * Usage: deno run -A scripts/go_port/core_l1_reference.ts [--snapshot=<dir>] [--target=<dir>]
 */
import { dirname, join, relative, resolve } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import { argValue } from "./cli_args.ts";
import { runPinnedAdapter } from "./core_l1_adapter.ts";
import { CORE_L1_REFERENCE } from "./core_l1_exports.ts";
import { loadManifest, verifySnapshot } from "./conformance/generate.ts";
import { pinnedJournalRunner, recordJournalCase, type TJournalRunner } from "./core_l1_journal_reference.ts";
import {
  pinnedBlueprintRunner,
  pinnedContextRunner,
  recordBlueprintCases,
  recordContextCases,
  type TBlueprintRunner,
  type TContextRunner,
} from "./core_l1_loader_reference.ts";
import { assertTargetAllowed, cloneSnapshot } from "./preserve_snapshot.ts";

export interface ICoreL1ConfigCase {
  readonly id: string;
  readonly root: string;
  readonly logLevel: string;
  readonly valid: boolean;
}

export interface IConfigIssue {
  readonly path: string;
  readonly code: string;
}

export type TConfigOutcome = "valid" | "invalid";

export interface IConfigObservation {
  readonly id: string;
  readonly outcome: TConfigOutcome;
  readonly authored_root: string;
  readonly log_level?: string;
  readonly resolved_root?: string;
  readonly issues: readonly IConfigIssue[];
}

export interface IRecordedConfigCase {
  readonly id: string;
  readonly tempRoot: string;
  readonly input: string;
  readonly observation: IConfigObservation;
}

interface IAdapterResult {
  readonly ok: boolean;
  readonly root?: string;
  readonly logLevel?: string;
  readonly issues?: readonly IConfigIssue[];
}

/** The runners that execute the pinned services. A test replaces them with fakes. */
export interface IPinnedRunners {
  readonly journal: TJournalRunner;
  readonly blueprint: TBlueprintRunner;
  readonly context: TContextRunner;
}

/** Authored independently of the pinned service. The recorder compares each observation with these values. */
export const CORE_L1_CONFIG_CASES: readonly ICoreL1ConfigCase[] = [
  { id: "config-explicit-root", root: "workspace", logLevel: "debug", valid: true },
  { id: "config-explicit-root-alternate", root: "nested/alternate", logLevel: "warn", valid: true },
  { id: "config-invalid-field", root: "workspace", logLevel: "verbose", valid: false },
];

const CORE_L1_REFERENCE_DIR = join("internal", "core", "l1", "testdata", "reference");

const INPUT_FILE = "exa.config.toml";
const OBSERVATION_FILE = "observation.json";
const JOURNAL_INPUT_FILE = "input.json";
const MANIFEST_SCHEMA_VERSION = 1;
const REPO_ROOT = resolve(join(import.meta.dirname ?? ".", "..", ".."));
const DEFAULT_TARGET = join("exaix-go", CORE_L1_REFERENCE_DIR);
const SANDBOX_NAME = "phase-249-core-l1-reference";

/** Runs in the snapshot: loads one file with the pinned service and wraps ConfigSchema to capture its issues. */
const ADAPTER = `const [root, requestPath] = Deno.args;
const { configPath } = JSON.parse(await Deno.readTextFile(requestPath));
const schemaModule = await import(new URL("file://" + root + "/packages/schemas/src/config.ts").href);
const { ConfigService } = await import(new URL("file://" + root + "/packages/core/src/config/service.ts").href);
const schema = schemaModule.ConfigSchema;
const original = schema.safeParse.bind(schema);
let observed;
schema.safeParse = (value) => {
  observed = original(value);
  return observed;
};
try {
  const config = new ConfigService(configPath).get();
  console.log(JSON.stringify({ ok: true, root: config.system.root, logLevel: config.system.log_level }));
} catch {
  const issues = observed && !observed.success
    ? observed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }))
    : [];
  console.log(JSON.stringify({ ok: false, issues }));
}
`;

function authoredInput(entry: ICoreL1ConfigCase): string {
  return `[system]\nroot = "${entry.root}"\nlog_level = "${entry.logLevel}"\n`;
}

async function runAdapter(snapshot: string, configPath: string): Promise<IAdapterResult> {
  return JSON.parse(await runPinnedAdapter(snapshot, ADAPTER, JSON.stringify({ configPath }), {}));
}

function observe(entry: ICoreL1ConfigCase, tempRoot: string, result: IAdapterResult): IConfigObservation {
  if (entry.valid) {
    if (!result.ok || result.root === undefined || result.logLevel === undefined) {
      throw new Error(`${entry.id}: the pinned service rejected an authored valid file`);
    }
    if (result.logLevel !== entry.logLevel) {
      throw new Error(`${entry.id}: the pinned service returned a log level other than the authored value`);
    }
    return {
      id: entry.id,
      outcome: "valid",
      authored_root: entry.root,
      log_level: result.logLevel,
      resolved_root: relative(tempRoot, result.root) || ".",
      issues: [],
    };
  }
  if (result.ok || !result.issues?.length) {
    throw new Error(`${entry.id}: the pinned service did not reject the authored invalid file`);
  }
  return { id: entry.id, outcome: "invalid", authored_root: entry.root, issues: result.issues };
}

/** Records every case against the pinned service, each in a new temporary root. */
export async function recordConfigCases(snapshot: string): Promise<IRecordedConfigCase[]> {
  const recorded: IRecordedConfigCase[] = [];
  for (const entry of CORE_L1_CONFIG_CASES) {
    const tempRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: `core-l1-${entry.id}-` }));
    try {
      const input = authoredInput(entry);
      const configPath = join(tempRoot, INPUT_FILE);
      await Deno.writeTextFile(configPath, input);
      const result = await runAdapter(snapshot, configPath);
      recorded.push({ id: entry.id, tempRoot, input, observation: observe(entry, tempRoot, result) });
    } finally {
      await Deno.remove(tempRoot, { recursive: true }).catch(() => {});
    }
  }
  return recorded;
}

async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const PINNED_RUNNERS: IPinnedRunners = {
  journal: pinnedJournalRunner,
  blueprint: pinnedBlueprintRunner,
  context: pinnedContextRunner,
};

interface IReferenceCase {
  readonly id: string;
  readonly inputFile: string;
  readonly input: string;
  readonly observation: string;
}

/** Writes the recorded cases and a manifest of their digests. Identical input produces identical bytes. */
export async function writeCoreL1Reference(
  snapshot: string,
  target: string,
  runners: IPinnedRunners,
): Promise<void> {
  const configCases: IReferenceCase[] = (await recordConfigCases(snapshot)).map((entry) => ({
    id: entry.id,
    inputFile: INPUT_FILE,
    input: entry.input,
    observation: `${JSON.stringify(entry.observation, null, 2)}\n`,
  }));
  const journal = await recordJournalCase(snapshot, runners.journal);
  const loaders = [
    ...await recordBlueprintCases(snapshot, runners.blueprint),
    ...await recordContextCases(snapshot, runners.context),
  ];
  const recorded = [
    ...configCases,
    { ...journal, inputFile: JOURNAL_INPUT_FILE },
    ...loaders.map((entry) => ({ ...entry, inputFile: JOURNAL_INPUT_FILE })),
  ];
  await Deno.mkdir(target, { recursive: true });
  const cases = [];
  for (const entry of recorded) {
    await Deno.mkdir(join(target, entry.id), { recursive: true });
    await Deno.writeTextFile(join(target, entry.id, entry.inputFile), entry.input);
    await Deno.writeTextFile(join(target, entry.id, OBSERVATION_FILE), entry.observation);
    cases.push({
      id: entry.id,
      input_sha256: await sha256Hex(entry.input),
      observation_sha256: await sha256Hex(entry.observation),
    });
  }
  const manifest = { schema_version: MANIFEST_SCHEMA_VERSION, reference_parent: CORE_L1_REFERENCE, cases };
  await Deno.writeTextFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

interface IVerifiedSnapshot {
  readonly path: string;
  readonly dispose: () => Promise<void>;
}

/** Uses the given snapshot, or clones the pinned one into the sibling sandbox tree and verifies it. */
async function acquireSnapshot(given: Opt<string, Reason.OptionalInput>): Promise<IVerifiedSnapshot> {
  const manifest = await loadManifest();
  const fresh = join(dirname(REPO_ROOT), "exaix-sandboxes", SANDBOX_NAME, crypto.randomUUID());
  const path = given ? resolve(given) : fresh;
  if (!given) {
    await assertTargetAllowed(REPO_ROOT, path);
    await Deno.mkdir(dirname(path), { recursive: true });
    await cloneSnapshot(manifest, path, REPO_ROOT);
  }
  const dispose = async () => {
    if (!given) await Deno.remove(path, { recursive: true }).catch(() => {});
  };
  const errors = await verifySnapshot(path, manifest);
  if (errors.length > 0) {
    await dispose();
    throw new Error(errors.join("; "));
  }
  return { path, dispose };
}

async function main(args: readonly string[]): Promise<number> {
  const target = resolve(argValue(args, "target") ?? join(REPO_ROOT, DEFAULT_TARGET));
  const snapshot = await acquireSnapshot(argValue(args, "snapshot"));
  try {
    await writeCoreL1Reference(snapshot.path, target, PINNED_RUNNERS);
  } finally {
    await snapshot.dispose();
  }
  console.log(`✅ ${target}`);
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
