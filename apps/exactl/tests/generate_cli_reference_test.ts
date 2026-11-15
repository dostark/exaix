/**
 * @module GenerateCliReferenceTest
 * @path apps/exactl/tests/generate_cli_reference_test.ts
 * @description Verifies that the CLI reference renderer builds one page per noun, one section per leaf and a manifest from the tree and the doc records, for Solo and Team.
 * @architectural-layer Test
 * @dependencies [@std/assert, @cliffy/command, apps/exactl/src/docs/cli_reference.ts]
 * @related-files [apps/exactl/src/docs/cli_reference.ts, scripts/generate_cli_reference.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Command } from "@cliffy/command";
import { ExaCtlExitCode, ExaCtlOutputKind, type IExaCtlCommandDoc } from "@exaix/cli";
import { createExaCtlCommand } from "../src/exactl.ts";
import { EXACTL_COMMAND_DOCS, EXACTL_NOUN_DOCS } from "../src/command_docs/mod.ts";
import { ExaCtlCommandGroup, type IExaCtlNounDoc } from "../src/docs/exactl_noun_doc.ts";
import { walkCommandTree } from "../src/docs/command_tree_walk.ts";
import { CliEdition, renderCliReference } from "../src/docs/cli_reference.ts";
import { formatMarkdown } from "./helpers/format_markdown.ts";
import type { ExaCtlCommandName } from "../src/exactl_constants.ts";

const MANIFEST_FILE = "exactl-cli.json";
const INDEX_FILE = "index.md";

interface IManifestCommand {
  path: string[];
  options: Array<{ flags: string[]; required: boolean; default?: string }>;
  edition?: string;
}

interface IManifest {
  version: number;
  edition: string;
  commands: IManifestCommand[];
}

function soloReference() {
  const root = createExaCtlCommand();
  return {
    root,
    reference: renderCliReference({
      root,
      nounDocs: EXACTL_NOUN_DOCS,
      commandDocs: EXACTL_COMMAND_DOCS,
      edition: CliEdition.SOLO,
    }),
  };
}

function manifestOf(files: ReadonlyMap<string, string>): IManifest {
  return JSON.parse(files.get(MANIFEST_FILE) ?? "{}") as IManifest;
}

Deno.test("each noun gets one page with front matter and one section per leaf", () => {
  const { reference } = soloReference();
  for (const noun of EXACTL_NOUN_DOCS) {
    const page = reference.files.get(`${noun.noun}.md`);
    assert(page !== undefined, `page of ${noun.noun}`);
    assertEquals(page.split("\n").slice(0, 2), ["---", `title: "exactl ${noun.noun}"`], `front matter of ${noun.noun}`);
    assertStringIncludes(page, `group: "${noun.group}"`);
    for (const doc of EXACTL_COMMAND_DOCS.filter((candidate) => candidate.path[0] === noun.noun)) {
      const sections = page.split("\n").filter((line) => line === `## exactl ${doc.path.join(" ")}`);
      assertEquals(sections.length, 1, doc.path.join(" "));
    }
  }
  const index = reference.files.get(INDEX_FILE) ?? "";
  for (const noun of EXACTL_NOUN_DOCS) {
    assertStringIncludes(index, `## ${noun.group}`);
    assertStringIncludes(index, `- [${noun.noun}](${noun.noun}.md): ${noun.summary}`);
  }
});

Deno.test("options, defaults and required flags come from the tree", () => {
  const { root, reference } = soloReference();
  const manifest = manifestOf(reference.files);
  let checked = 0;
  for (const node of walkCommandTree(root)) {
    const entry = manifest.commands.find((command) => command.path.join(" ") === node.path.join(" "));
    if (entry === undefined) continue;
    for (const option of node.options.filter((candidate) => !candidate.hidden)) {
      const listed = entry.options.find((candidate) => candidate.flags.join(",") === option.flags.join(","));
      assert(listed !== undefined, `${node.path.join(" ")} ${option.flags.join(",")}`);
      assertEquals(listed.required, option.required);
      assertEquals(listed.default, option.defaultValue);
      checked += 1;
    }
  }
  assert(checked > 20, "the tree has options to compare");
  const withDefault = manifest.commands.flatMap((command) => command.options).filter((option) =>
    option.default !== undefined
  );
  assert(withDefault.length > 0, "an option with a default");
});

Deno.test("the JSON manifest lists every leaf exactly once", () => {
  const { reference } = soloReference();
  const manifest = manifestOf(reference.files);
  assertEquals(manifest.version, 1);
  assertEquals(manifest.edition, CliEdition.SOLO);
  const listed = manifest.commands.map((command) => command.path.join(" "));
  assertEquals(new Set(listed).size, listed.length);
  assertEquals([...listed].sort(), EXACTL_COMMAND_DOCS.map((doc) => doc.path.join(" ")).sort());
});

Deno.test("the Solo output contains no Team-only leaf", () => {
  const { reference } = soloReference();
  for (const [name, content] of reference.files) assert(!content.includes("export-otel"), name);
  assert(!reference.userGuideTable.includes("export-otel"));
});

const SYNTHETIC_NOUN = "thing" as ExaCtlCommandName;

function syntheticDoc(path: string[], summary: string): IExaCtlCommandDoc {
  return {
    path,
    summary,
    description: `${summary}.`,
    examples: [{ title: "Run it", command: `exactl ${path.join(" ")}` }],
    seeAlso: [],
    exitCodes: [ExaCtlExitCode.FAILURE],
    output: ExaCtlOutputKind.ITEM,
  };
}

const SYNTHETIC_NOUN_DOC: IExaCtlNounDoc = {
  noun: SYNTHETIC_NOUN,
  group: ExaCtlCommandGroup.OPERATIONS,
  summary: "Things",
  description: "A thing.",
  lifecycle: [],
};

function syntheticRoot(withTeamLeaf: boolean) {
  const thing = new Command().description("Things")
    .command("list", new Command().description("List things").option("--all", "Include every thing"))
    .command("show", new Command().description("Show a thing"));
  if (withTeamLeaf) {
    thing.command("export", new Command().description("Export things").option("-f, --file <file:string>", "Target"));
  }
  return new Command().name("exactl").command("thing", thing);
}

Deno.test("the Team page set equals the Team tree minus the Solo manifest and marks them team", () => {
  const docs = [syntheticDoc(["thing", "list"], "List things"), syntheticDoc(["thing", "show"], "Show a thing")];
  const solo = renderCliReference({
    root: syntheticRoot(false),
    nounDocs: [SYNTHETIC_NOUN_DOC],
    commandDocs: docs,
    edition: CliEdition.SOLO,
  });
  const soloPaths = new Set(manifestOf(solo.files).commands.map((command) => command.path.join(" ")));
  const team = renderCliReference({
    root: syntheticRoot(true),
    nounDocs: [SYNTHETIC_NOUN_DOC],
    commandDocs: [...docs, { ...syntheticDoc(["thing", "export"], "Export things"), seeAlso: ["exactl thing list"] }],
    edition: CliEdition.TEAM,
    soloPaths,
  });
  assertEquals([...team.files.keys()].sort(), [MANIFEST_FILE, INDEX_FILE, "thing.md"]);
  const manifest = manifestOf(team.files);
  assertEquals(manifest.edition, CliEdition.TEAM);
  assertEquals(manifest.commands.map((command) => [command.path.join(" "), command.edition]), [[
    "thing export",
    "team",
  ]]);
  assertStringIncludes(team.files.get(INDEX_FILE) ?? "", "(../../../docs/cli/index.md)");
  const page = team.files.get("thing.md") ?? "";
  assertStringIncludes(page, "## exactl thing export");
  assert(!page.includes("## exactl thing list"));
  assertStringIncludes(page, "(../../../docs/cli/thing.md#exactl-thing-list)");
  assertStringIncludes(page, 'edition: "team"');
});

Deno.test("the output is stable under deno fmt", async () => {
  const { reference } = soloReference();
  for (const [name, content] of reference.files) {
    if (!name.endsWith(".md")) continue;
    assertEquals(await formatMarkdown(content), content, name);
  }
  const table = `${reference.userGuideTable}\n`;
  assertEquals(await formatMarkdown(table), table);
});
