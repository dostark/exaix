/**
 * @module ModelToolRoundDocsTest
 * @path packages/execution/tests/model_tool_round_docs_test.ts
 * @description Phase 202 Step 9. Checks the parallel tool-call documentation against the shipped code. TOML examples
 *   parse through ConfigSchema and resolve to the documented round policy. Documented bounds match the schema at each
 *   end. Profile and replay rows cite test files that exist. Event rows name real DomainEventType members.
 * @architectural-layer Test
 * @dependencies [@exaix/schemas, @exaix/core, @exaix/core/events, @std/toml, @std/assert]
 * @related-files [packages/schemas/src/tools_round_policy.ts, packages/schemas/src/config.ts, packages/core/src/events/domain_event_types.ts]
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { ConfigSchema } from "@exaix/schemas";
import { resolveToolsRoundPolicy } from "@exaix/schemas/tools_round_policy.ts";
import { ToolsRoundLoop } from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";

const REPO_ROOT = new URL("../../../", import.meta.url);
const GUIDE_HEADING = "### Parallel tool calls";
const ARCHITECTURE_HEADING = "#### Parallel tool-round policy and provider profiles";
const TOOLS_HEADING = "## Native Tool Calls per Response";
const CODE_STYLE_HEADING = "## Native Tool-Round Replay";
const EVENT_HEADING = "## Event Taxonomy";
const REQUIRED_EVENT_MEMBERS = [
  "AgentDynamicToolCall",
  "PlanningToolLoopCompleted",
  "PlanningToolLoopAborted",
  "PlanningToolsSkipped",
];
/** The fragments are parts of a full config, so each one gets the table ConfigSchema requires. */
const CONFIG_BASE = { system: {} };
const HEADING_PREFIX = /^#+ /;
const FENCE = "```";

async function readDoc(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, REPO_ROOT));
}

/** The lines under a heading, up to the next heading of the same or a higher level. Fenced lines never end a section. */
function sectionOf(markdown: string, heading: string): string {
  const level = heading.match(/^#+/)![0].length;
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} {`));
  assert(start >= 0, `missing heading: ${heading}`);
  let inFence = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith(FENCE)) inFence = !inFence;
    if (!inFence && HEADING_PREFIX.test(lines[i]) && lines[i].match(/^#+/)![0].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function tomlBlocks(section: string): string[] {
  return [...section.matchAll(/```toml\n([\s\S]*?)```/g)].map((match) => match[1]);
}

/** Markdown table rows as trimmed cells, with the header separator skipped. Backticks stay in the cells. */
function tableRows(section: string): string[][] {
  return section.split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

/** A cell's text without its code-span backticks, for a key or event name. */
function plain(cell: string): string {
  return cell.replaceAll("`", "");
}

function backtickedTestPaths(section: string): string[] {
  return [...section.matchAll(/`([^`\s]+\.ts)`/g)].map((match) => match[1]);
}

function fragment(key: string, value: number | string): Record<string, Record<string, number | string>> {
  const [section, field] = key.split(".");
  return { [section]: { [field]: value } };
}

/** The ConfigSchema issue codes at the documented key's own path, empty when the value is accepted. */
function issueCodesFor(key: string, value: number): string[] {
  const parsed = ConfigSchema.safeParse({ ...CONFIG_BASE, ...fragment(key, value) });
  if (parsed.success) return [];
  return parsed.error.issues.filter((issue) => issue.path.join(".") === key).map((issue) => issue.code);
}

const guide = await readDoc("docs/Exaix_User_Guide.md");
const architecture = await readDoc("ARCHITECTURE.md");
const referenceData = await readDoc("docs/Reference_Data.md");
const tools = await readDoc(".copilot/docs/TOOLS.md");
const codeStyle = await readDoc("docs/CODE_STYLE.md");

Deno.test("[model_tool_round_docs] every parallel tool-call TOML example parses through ConfigSchema", () => {
  const blocks = tomlBlocks(sectionOf(guide, GUIDE_HEADING));
  assert(blocks.length >= 3, `expected the auto, off and planning examples, found ${blocks.length}`);
  for (const block of blocks) {
    const parsed = ConfigSchema.safeParse({ ...CONFIG_BASE, ...parseToml(block) });
    assert(parsed.success, `example rejected by ConfigSchema:\n${block}`);
  }
});

Deno.test("[model_tool_round_docs] the auto, off and planning examples resolve to the documented round policy", () => {
  const [auto, off, planning] = tomlBlocks(sectionOf(guide, GUIDE_HEADING))
    .map((block) => ConfigSchema.parse({ ...CONFIG_BASE, ...parseToml(block) }));
  const planningCap = (config: ReturnType<typeof ConfigSchema.parse>) => config.planning!.max_tool_calls_per_round;

  const autoPolicy = resolveToolsRoundPolicy(auto, undefined, ToolsRoundLoop.REACT, planningCap(auto));
  assertEquals(autoPolicy.mode, "auto");
  assertEquals(autoPolicy.executionCap, 4, "auto keeps the ReAct cap, tools.max_calls_per_turn");

  const offPolicy = resolveToolsRoundPolicy(off, undefined, ToolsRoundLoop.REACT, planningCap(off));
  assertEquals(offPolicy.mode, "off");
  assertEquals(offPolicy.executionCap, 1, "off enforces one executed call per response");
  assertEquals(offPolicy.concurrency, 1, "off runs one call at a time");

  assertEquals(planning.planning!.tools_enabled, true);
  assertEquals(planning.planning!.max_tool_rounds, 4);
  assertEquals(planning.planning!.max_tool_calls_per_round, 3);
});

Deno.test("[model_tool_round_docs] documented bounds match ConfigSchema at the default, both ends and one past each end", () => {
  const rows = tableRows(sectionOf(guide, GUIDE_HEADING)).filter((cells) => /^\d+$/.test(cells[2] ?? ""));
  assert(rows.length >= 9, `expected the numeric limit rows, found ${rows.length}`);
  const defaults = ConfigSchema.parse(CONFIG_BASE);
  for (const [keyCell, defaultCell, minCell, maxCell] of rows) {
    const key = plain(keyCell);
    const [section, field] = key.split(".");
    const schemaDefault =
      (JSON.parse(JSON.stringify(defaults)) as Record<string, Record<string, number>>)[section][field];
    assertEquals(Number(defaultCell), schemaDefault, `documented default for ${key}`);
    const min = Number(minCell);
    const max = Number(maxCell);
    assertEquals(issueCodesFor(key, min).filter((code) => code === "too_small"), [], `min of ${key} is accepted`);
    assertEquals(issueCodesFor(key, max).filter((code) => code === "too_big"), [], `max of ${key} is accepted`);
    assert(issueCodesFor(key, min - 1).includes("too_small"), `min - 1 of ${key} is rejected`);
    assert(issueCodesFor(key, max + 1).includes("too_big"), `max + 1 of ${key} is rejected`);
  }
});

Deno.test("[model_tool_round_docs] the documented response ceiling rule is enforced when the config loads", () => {
  const parsed = ConfigSchema.safeParse({ ...CONFIG_BASE, tools: { max_response_calls: 3 } });
  assert(!parsed.success, "a response ceiling below the default loop caps must be rejected");
  assertEquals(
    parsed.error.issues.find((issue) => issue.path.join(".") === "tools.max_response_calls")?.code,
    "custom",
  );
});

Deno.test("[model_tool_round_docs] every provider profile row cites a test file that exists", async () => {
  const rows = tableRows(sectionOf(architecture, ARCHITECTURE_HEADING))
    .filter((cells) => cells.length >= 4 && cells[0] !== "Profile");
  assert(rows.length >= 6, `expected a row for each provider profile, found ${rows.length}`);
  for (const cells of rows) {
    const paths = backtickedTestPaths(cells.join(" "));
    assert(paths.length >= 1, `row cites no test: ${cells[0]}`);
    for (const path of paths) {
      await Deno.stat(new URL(path, REPO_ROOT));
    }
  }
});

Deno.test("[model_tool_round_docs] the documented event rows name real DomainEventType members and values", () => {
  const rows = tableRows(sectionOf(referenceData, EVENT_HEADING));
  const documented = new Map(rows.map((cells) => [plain(cells[0]), plain(cells[1])]));
  for (const member of REQUIRED_EVENT_MEMBERS) {
    assertEquals(
      documented.get(member),
      DomainEventType[member as keyof typeof DomainEventType],
      `event row for ${member}`,
    );
  }
});

Deno.test("[model_tool_round_docs] the TOOLS and CODE_STYLE replay sections cite test files that exist", async () => {
  for (const section of [sectionOf(tools, TOOLS_HEADING), sectionOf(codeStyle, CODE_STYLE_HEADING)]) {
    const paths = backtickedTestPaths(section);
    assert(paths.length >= 1, "the section cites no test file");
    for (const path of paths) {
      await Deno.stat(new URL(path, REPO_ROOT));
    }
  }
  assertStringIncludes(sectionOf(codeStyle, CODE_STYLE_HEADING), "thoughtSignature");
});

/** One documented per-loop guarantee, the file whose test proves it, and a fragment of that test's title. */
const ENFORCEMENT_TESTS = [
  ["packages/execution/tests/react_native_round_security_test.ts", "a ReAct response over the response ceiling"],
  ["packages/execution/tests/react_native_round_security_test.ts", "a ReAct response that reuses an earlier turn id"],
  ["packages/execution/tests/native_tool_round_security_test.ts", "reuses an earlier round id executes no tool"],
  ["packages/execution/tests/native_tool_round_security_test.ts", "push it over the replay ceiling"],
  ["packages/execution/tests/native_tool_turns_test.ts", "exactly at the replay ceiling"],
] as const;

Deno.test("[model_tool_round_docs] the User Guide names the limits each loop enforces, and tests prove them", async () => {
  const section = sectionOf(await readDoc("docs/Exaix_User_Guide.md"), GUIDE_HEADING).replace(/\s+/g, " ");
  assertStringIncludes(section, "The response, argument and replay limits apply to both loops.");
  assertStringIncludes(section, "reuses a call id from an earlier round");
  for (const [path, titleFragment] of ENFORCEMENT_TESTS) {
    assertStringIncludes(await Deno.readTextFile(new URL(path, REPO_ROOT)), titleFragment, `${path} lacks its test`);
  }
});
