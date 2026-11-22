#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCollectInputs
 * @path scripts/go_port/conformance/adapters/collect_inputs.ts
 * @description Collects the base inputs of each keep schema from repository files, recorded test calls and enum options, and prints them as JSON.
 * A recorded input is kept only when every record file holds it, so an input with a timestamp or a random ID is dropped.
 * Usage: TZ=UTC deno run --config <snapshot>/deno.json collect_inputs.ts <snapshot> <keep.json> <record.jsonl>...
 */
import type { TInputKind } from "../generate.ts";
import { type IInputDocument, type IKeepEntry, loadSchemas, type TRaw } from "./raw_value.ts";
import { synthesize } from "./synthesize.ts";

interface IFamily {
  readonly key: string;
  readonly kind: TInputKind;
  readonly directories: readonly string[];
  readonly suffix: string;
  readonly frontmatter: boolean;
}

interface IBases {
  readonly files: IInputDocument[];
  readonly mined: IInputDocument[];
  readonly enums: string[];
  readonly synth: string | null;
}

interface IEnumLike {
  readonly _zod?: { readonly def?: { readonly type?: string; readonly entries?: { readonly [key: string]: TRaw } } };
}

const MAX_FILES_PER_FAMILY = 200;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const FAMILIES: readonly IFamily[] = [
  {
    key: "config.ConfigSchema",
    kind: "toml",
    directories: [
      "tests/configs",
      "tests/integration/fixtures/configs",
      "tests/scenario_framework/fixtures/configs",
      "configs",
    ],
    suffix: ".toml",
    frontmatter: false,
  },
  { key: "flow.FlowSchema", kind: "yaml", directories: ["Blueprints/Flows"], suffix: ".flow.yaml", frontmatter: false },
  {
    key: "blueprint.BlueprintFrontmatterSchema",
    kind: "yaml",
    directories: ["Blueprints/Agents"],
    suffix: ".md",
    frontmatter: true,
  },
  {
    key: "skill_folder.SkillFrontmatterSchema",
    kind: "yaml",
    directories: ["Blueprints/Skills"],
    suffix: "SKILL.md",
    frontmatter: true,
  },
  {
    key: "skill_folder.SkillSidecarSchema",
    kind: "yaml",
    directories: ["Blueprints/Skills"],
    suffix: "exaix.yaml",
    frontmatter: false,
  },
  {
    key: "request.RequestSchema",
    kind: "yaml",
    directories: ["tests/scenario_framework/fixtures/requests"],
    suffix: ".md",
    frontmatter: true,
  },
  {
    key: "plan_schema.PlanFrontmatterSchema",
    kind: "yaml",
    directories: ["tests/fixtures/cli/plan_commands_test", "tests/fixtures/services/plan"],
    suffix: ".md",
    frontmatter: true,
  },
];

async function filesUnder(directory: string, suffix: string, found: string[]): Promise<void> {
  const entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) await filesUnder(path, suffix, found);
    else if (entry.name.endsWith(suffix)) found.push(path);
  }
}

async function familyInputs(root: string, family: IFamily): Promise<IInputDocument[]> {
  const found: string[] = [];
  for (const directory of family.directories) await filesUnder(`${root}/${directory}`, family.suffix, found);
  const documents: IInputDocument[] = [];
  for (const path of found.slice(0, MAX_FILES_PER_FAMILY)) {
    const text = await Deno.readTextFile(path);
    const content = family.frontmatter ? FRONTMATTER.exec(text)?.[1] : text;
    if (content !== undefined) documents.push({ kind: family.kind, content });
  }
  return documents;
}

function enumOptions(target: IEnumLike): string[] {
  const definition = target._zod?.def;
  if (definition?.type !== "enum" || !definition.entries) return [];
  return Object.values(definition.entries).map((option) => JSON.stringify(option));
}

async function recorded(file: string): Promise<Map<string, IInputDocument[]>> {
  const grouped = new Map<string, IInputDocument[]>();
  let text = "";
  try {
    text = await Deno.readTextFile(file);
  } catch {
    return grouped;
  }
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const row: { key: string; input: string } = JSON.parse(line);
    const value: TRaw = JSON.parse(row.input);
    const document: IInputDocument = typeof value === "string"
      ? { kind: "text", content: value }
      : { kind: "json", content: row.input };
    const list = grouped.get(row.key) ?? [];
    list.push(document);
    grouped.set(row.key, list);
  }
  return grouped;
}

function unique(documents: readonly IInputDocument[]): IInputDocument[] {
  const seen = new Map<string, IInputDocument>();
  for (const item of documents) seen.set(`${item.kind}\n${item.content}`, item);
  return [...seen.values()].sort((a, b) => a.content.length - b.content.length || (a.content < b.content ? -1 : 1));
}

function intersect(runs: readonly Map<string, IInputDocument[]>[]): Map<string, IInputDocument[]> {
  const [first, ...others] = runs;
  const result = new Map<string, IInputDocument[]>();
  for (const [key, documents] of first ?? []) {
    const kept = documents.filter((document) =>
      others.every((run) =>
        (run.get(key) ?? []).some((other) => other.kind === document.kind && other.content === document.content)
      )
    );
    result.set(key, kept);
  }
  return result;
}

async function main(): Promise<void> {
  const [root, keepFile, ...recordFiles] = Deno.args;
  const entries: IKeepEntry[] = JSON.parse(await Deno.readTextFile(keepFile));
  const registered = await loadSchemas(root, entries);
  const mined = intersect(await Promise.all(recordFiles.map(recorded)));
  const result: { [key: string]: IBases } = {};
  for (const item of registered) {
    const family = FAMILIES.find((candidate) => candidate.key === item.key);
    result[item.key] = {
      files: family ? unique(await familyInputs(root, family)) : [],
      mined: unique(mined.get(item.key) ?? []),
      enums: enumOptions(item.target as IEnumLike),
      synth: synthesize(item.schema) ?? null,
    };
  }
  console.log(JSON.stringify(result));
}

await main();
