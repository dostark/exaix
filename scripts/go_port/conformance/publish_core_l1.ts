#!/usr/bin/env -S deno run -A
/**
 * @module GoPortPublishCoreL1
 * @path scripts/go_port/conformance/publish_core_l1.ts
 * @description Publishes the recorded core-l1 cases as one immutable version 2 generation through the locked conformance flow.
 * Usage: deno run -A scripts/go_port/conformance/publish_core_l1.ts [--target=<dir>]
 */
import { join, resolve } from "@std/path";
import { argValue } from "./../cli_args.ts";
import { CORE_L1_LOCKFILE } from "./../core_l1_case_reference.ts";
import { CORE_L1_REFERENCE } from "./../core_l1_exports.ts";
import {
  type ICaseResultV2,
  type ICaseV2,
  type ISnapshotManifest,
  type ISuiteDefinition,
  loadManifest,
  prepareGeneration,
  publishGeneration,
} from "./generate.ts";

const REPO_ROOT = resolve(join(import.meta.dirname ?? ".", "..", "..", ".."));
const CASES_PATH = join(REPO_ROOT, "exaix-go", "internal", "core", "l1", "testdata", "reference", "core_l1_cases.json");
const TARGET = join(REPO_ROOT, "exaix-go", "testdata", "conformance", "core-l1");
const SUITE = "core-l1";

const REQUIRED_IDS = [
  "config-explicit-root",
  "config-explicit-root-alternate",
  "config-invalid-field",
  "journal-chained-rows",
  "blueprint-yaml-optional",
  "blueprint-yaml-configured-model",
  "blueprint-yaml-explicit",
  "blueprint-plain-markdown",
  "blueprint-retired-toml",
  "blueprint-unknown-fields",
  "blueprint-invalid-frontmatter",
  "blueprint-invalid-yaml",
  "blueprint-empty-frontmatter",
  "blueprint-crlf-is-plain",
  "blueprint-frontmatter-list",
  "blueprint-missing-role",
  "context-budget-and-order",
  "context-drop-largest",
  "context-drop-oldest",
  "context-truncate-each",
  "context-truncate-each-partial",
  "context-truncate-each-insufficient",
  "context-truncate-each-exact-100",
  "context-exact-fit",
  "context-per-file-cap",
  "context-fractional-margin",
  "context-local-agent",
  "context-unicode-estimate",
  "context-missing-and-empty",
  "process-request-outcomes",
  "config-toml-writes",
  "prompt-budget-enforced",
  "prompt-budget-disabled",
  "blueprint-fragments",
  "context-card-notes",
];

interface IRecordedCase {
  readonly id: string;
  readonly schema: string;
  readonly input: { readonly kind: "json"; readonly content: string };
  readonly reference: ICaseResultV2["reference"];
}

interface IRecordedCorpus {
  readonly schema_version: number;
  readonly suite: string;
  readonly reference: { readonly parent: string; readonly lockfile: string };
  readonly cases: readonly IRecordedCase[];
}

function fail(message: string): never {
  throw new Error(`core-l1 publication: ${message}`);
}

async function readCorpus(): Promise<IRecordedCorpus> {
  const corpus = JSON.parse(await Deno.readTextFile(CASES_PATH)) as IRecordedCorpus;
  if (corpus.schema_version !== 2 || corpus.suite !== SUITE) fail("the recorded corpus has the wrong version or suite");
  if (corpus.reference.parent !== CORE_L1_REFERENCE) fail("the recorded corpus has the wrong parent");
  if (corpus.reference.lockfile !== CORE_L1_LOCKFILE) fail("the recorded corpus has the wrong lockfile");
  const ids = new Set(corpus.cases.map((entry) => entry.id));
  const missing = REQUIRED_IDS.filter((id) => !ids.has(id));
  if (missing.length > 0) fail(`the recorded corpus lacks ${missing.join(", ")}`);
  if (ids.size !== REQUIRED_IDS.length || ids.size !== corpus.cases.length) {
    fail("the recorded corpus has unexpected or duplicate case IDs");
  }
  return corpus;
}

async function publish(target: string): Promise<{ digest: string; ids: string[] }> {
  const corpus = await readCorpus();
  const cases: ICaseV2[] = corpus.cases.map((entry) => ({
    id: entry.id,
    schema: entry.schema,
    input: entry.input,
  }));
  const results: ICaseResultV2[] = corpus.cases.map((entry) => ({ id: entry.id, reference: entry.reference }));
  const definition: ISuiteDefinition = { version: 2, cases, evaluate: () => Promise.resolve(results) };
  const manifest: ISnapshotManifest = await loadManifest();
  if (manifest.parent !== CORE_L1_REFERENCE) fail("the snapshot manifest parent differs from the corpus");
  const generation = await prepareGeneration(target, SUITE, results, manifest, { [SUITE]: definition });
  await publishGeneration(target, generation);
  return { digest: generation.digest, ids: corpus.cases.map((entry) => entry.id) };
}

async function main(args: readonly string[]): Promise<number> {
  const target = argValue(args, "target") ?? TARGET;
  const published = await publish(target);
  console.log(JSON.stringify({ suite: SUITE, generation: published.digest, cases: published.ids }, null, 2));
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
