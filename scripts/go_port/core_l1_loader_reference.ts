#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL1LoaderReference
 * @path scripts/go_port/core_l1_loader_reference.ts
 * @description Records what the pinned IBlueprintLoader and ContextLoader return for authored files in real temporary directories.
 * The recorded paths are relative to the case root, so a second run produces the same bytes.
 * Usage: imported by core_l1_reference.ts.
 */
import { join } from "@std/path";
import { runPinnedAdapter } from "./core_l1_adapter.ts";

export type TTruncationStrategy = "smallest-first" | "drop-largest" | "drop-oldest" | "truncate-each";

/** One blueprint file that the pinned loader reads, or the absence of it. */
export interface IBlueprintSpec {
  readonly id: string;
  readonly role: string;
  readonly default_model: string | null;
  readonly present: boolean;
  readonly content: string;
}

export interface IContextFileSpec {
  readonly path: string;
  readonly content: string;
  readonly mtime_ms: number;
}

export interface IContextConfigSpec {
  readonly max_tokens: number;
  readonly safety_margin: number;
  readonly truncation_strategy: TTruncationStrategy;
  readonly per_file_token_cap: number | null;
  readonly is_local_agent: boolean;
}

/** One context load: the files that exist, the configuration and the paths that the caller requests. */
export interface IContextSpec {
  readonly id: string;
  readonly config: IContextConfigSpec;
  readonly files: readonly IContextFileSpec[];
  readonly requested: readonly string[];
}

export interface ILoadedBlueprint {
  readonly agentRole: string;
  readonly name: string;
  readonly model: string;
  readonly provider?: string;
  readonly capabilities: readonly string[];
  readonly systemPrompt: string;
  readonly version: string;
  readonly frontmatter: object;
  readonly path: string;
}

export interface IBlueprintError {
  readonly kind: string;
  readonly message: string;
  readonly paths: readonly string[];
}

export interface IBlueprintObservation {
  readonly outcome: string;
  readonly loaded?: ILoadedBlueprint;
  readonly error?: IBlueprintError;
  readonly warnings: readonly string[];
}

export interface IContextObservation {
  readonly content: string;
  readonly warnings: readonly string[];
  readonly totalTokens: number;
  readonly includedFiles: readonly string[];
  readonly skippedFiles: readonly string[];
  readonly truncatedFiles: readonly string[];
}

export type TBlueprintRunner = (
  snapshot: string,
  specs: readonly IBlueprintSpec[],
) => Promise<readonly IBlueprintObservation[]>;

export type TContextRunner = (
  snapshot: string,
  specs: readonly IContextSpec[],
) => Promise<readonly IContextObservation[]>;

export interface IRecordedLoaderCase {
  readonly id: string;
  readonly input: string;
  readonly observation: string;
}

const RESULT_PREFIX = "RESULT:";
const PER_FILE_CAP = 100;
const ONE_DAY_MS = 86_400_000;
const BASE_TIME_MS = Date.UTC(2026, 0, 1);

const FULL_FRONTMATTER = [
  "---",
  "agent_role: explicit-agent",
  "name: Explicit Agent",
  "model: anthropic:model-x",
  "provider: anthropic",
  "preferred_provider: anthropic",
  "model_size: M",
  "characteristics:",
  "  - cheapest",
  "capabilities:",
  "  - code",
  "  - review",
  "version: 2.3.4",
  "description: An agent with every runtime field",
  "routing_hint: reviews",
  "language: en",
  "task_type: review",
  "portal_type: app",
  'created: "2026-01-01T00:00:00Z"',
  "created_by: owner",
  "reflexive: true",
  "max_reflexion_iterations: 5",
  "confidence_required: 80",
  "memory_enabled: true",
  "default_skills:",
  "  - tdd",
  "permitted_tools:",
  "  - read_file",
  "  - Read",
  "output_contract: verdict",
  "deprecated: false",
  "routing_prefer_local: true",
  "thinking: auto",
  "effort: high",
  "hitl:",
  "  require_secondary_approval:",
  "    - tool: Write",
  "      path_pattern: 'src/**'",
  "      reason: Writes need review",
  "session_delegate:",
  "  enabled: true",
  "  tool: claude",
  "  extra_key: kept",
  "---",
  "",
  "  Explicit prompt.  ",
  "",
].join("\n");

function blueprint(id: string, content: string, extra: Partial<IBlueprintSpec> = {}): IBlueprintSpec {
  return { id, role: "sample-agent", default_model: null, present: true, content, ...extra };
}

/** The authored blueprint files. Every case id is a case directory of the reference fixtures. */
export const BLUEPRINT_SPECS: readonly IBlueprintSpec[] = [
  blueprint("blueprint-yaml-optional", "---\ndescription: Reviews code\n---\n\n  You review code carefully.  \n\n"),
  blueprint("blueprint-yaml-configured-model", "---\nname: Configured Agent\n---\nBody\n", {
    default_model: "anthropic:configured",
  }),
  blueprint("blueprint-yaml-explicit", FULL_FRONTMATTER),
  blueprint("blueprint-plain-markdown", "  # Plain\n\nPrompt with {{include:shared}} text.\n\n"),
  blueprint("blueprint-retired-toml", '+++\nagent_role = "sample-agent"\n+++\nBody\n'),
  blueprint("blueprint-yaml-date-created", "---\ncreated: 2026-01-01T00:00:00Z\nname: Dated\n---\nBody\n"),
  blueprint("blueprint-unknown-fields", "---\nzeta: 1\nname: Named\nalpha: two\n---\nBody\n"),
  blueprint(
    "blueprint-invalid-frontmatter",
    '---\nmodel_size: XXL\nmax_reflexion_iterations: 99\nname: ""\n---\nBody\n',
  ),
  blueprint("blueprint-invalid-yaml", "---\nname: [unclosed\n---\nBody\n"),
  blueprint("blueprint-empty-frontmatter", "---\n---\nBody after nothing\n"),
  blueprint("blueprint-crlf-is-plain", "---\r\nname: Crlf\r\n---\r\nBody\r\n"),
  blueprint("blueprint-frontmatter-list", "---\n- a\n- b\n---\nBody\n"),
  blueprint("blueprint-frontmatter-blank", "---\n\n---\nBody\n"),
  blueprint("blueprint-missing-role", "", { present: false }),
];

function filler(chars: number, letter = "a"): string {
  return letter.repeat(chars);
}

function contextFile(path: string, content: string, ageDays: number): IContextFileSpec {
  return { path, content, mtime_ms: BASE_TIME_MS - ageDays * ONE_DAY_MS };
}

const SIZED_FILES: readonly IContextFileSpec[] = [
  contextFile("huge.txt", filler(4000, "h"), 1),
  contextFile("big.txt", filler(2000, "b"), 5),
  contextFile("mid.txt", filler(1200, "m"), 3),
  contextFile("small.txt", filler(400, "s"), 9),
  contextFile("tiny.txt", filler(40, "t"), 2),
  contextFile("empty.txt", "", 4),
];
const SIZED_REQUEST: readonly string[] = [
  "huge.txt",
  "big.txt",
  "missing.txt",
  "mid.txt",
  "small.txt",
  "tiny.txt",
  "empty.txt",
];

function config(strategy: TTruncationStrategy, extra: Partial<IContextConfigSpec> = {}): IContextConfigSpec {
  return {
    max_tokens: 1000,
    safety_margin: 0.8,
    truncation_strategy: strategy,
    per_file_token_cap: null,
    is_local_agent: false,
    ...extra,
  };
}

/** The authored context loads. Each case covers one strategy or one rule of the pinned loader. */
export const CONTEXT_SPECS: readonly IContextSpec[] = [
  { id: "context-budget-and-order", config: config("smallest-first"), files: SIZED_FILES, requested: SIZED_REQUEST },
  { id: "context-drop-largest", config: config("drop-largest"), files: SIZED_FILES, requested: SIZED_REQUEST },
  { id: "context-drop-oldest", config: config("drop-oldest"), files: SIZED_FILES, requested: SIZED_REQUEST },
  { id: "context-truncate-each", config: config("truncate-each"), files: SIZED_FILES, requested: SIZED_REQUEST },
  {
    id: "context-truncate-each-partial",
    config: config("truncate-each", { max_tokens: 300, safety_margin: 1 }),
    files: SIZED_FILES,
    requested: ["tiny.txt", "big.txt", "mid.txt"],
  },
  {
    id: "context-truncate-each-insufficient",
    config: config("truncate-each", { max_tokens: 150, safety_margin: 1 }),
    files: SIZED_FILES,
    requested: ["small.txt", "mid.txt", "tiny.txt"],
  },
  {
    id: "context-truncate-each-exact-100",
    config: config("truncate-each", { max_tokens: 200, safety_margin: 1 }),
    files: SIZED_FILES,
    requested: ["small.txt", "mid.txt"],
  },
  {
    id: "context-exact-fit",
    config: config("smallest-first", { max_tokens: 410, safety_margin: 1 }),
    files: SIZED_FILES,
    requested: SIZED_REQUEST,
  },
  {
    id: "context-per-file-cap",
    config: config("smallest-first", { per_file_token_cap: PER_FILE_CAP }),
    files: SIZED_FILES,
    requested: SIZED_REQUEST,
  },
  {
    id: "context-fractional-margin",
    config: config("smallest-first", { max_tokens: 1001, safety_margin: 0.85 }),
    files: SIZED_FILES,
    requested: SIZED_REQUEST,
  },
  {
    id: "context-local-agent",
    config: config("smallest-first", { is_local_agent: true }),
    files: SIZED_FILES,
    requested: SIZED_REQUEST,
  },
  {
    id: "context-unicode-estimate",
    config: config("smallest-first"),
    files: [
      contextFile("emoji.txt", "😀".repeat(300), 1),
      contextFile("cjk.txt", "日本語".repeat(100), 2),
      contextFile("accent.txt", "héllo wörld ".repeat(20), 3),
    ],
    requested: ["emoji.txt", "cjk.txt", "accent.txt"],
  },
  {
    id: "context-missing-and-empty",
    config: config("smallest-first"),
    files: [contextFile("empty.txt", "", 1)],
    requested: ["missing.txt", "empty.txt"],
  },
];

function errorKind(name: string, message: string): string {
  if (message.includes("retired TOML")) return "retired_format";
  if (message.startsWith("Invalid YAML frontmatter")) return "invalid_yaml";
  if (message.startsWith("Invalid frontmatter")) return "invalid_frontmatter";
  return name === "BlueprintLoadError" ? "load_failed" : "unexpected";
}

/** Lists the field paths that a zod issue list names. The Go decoder reports the same paths. */
function issuePaths(message: string): string[] {
  const marker = "Invalid frontmatter in blueprint '";
  if (!message.startsWith(marker)) return [];
  const list = message.slice(message.indexOf("': ") + 3);
  return list.split(/, (?=[A-Za-z0-9_.\[\]]*: )/).map((entry) => entry.slice(0, entry.indexOf(": ")));
}

interface IRawBlueprint {
  readonly outcome: string;
  readonly loaded: (ILoadedBlueprint & { readonly path: string }) | null;
  readonly name: string;
  readonly message: string;
  readonly warnings: readonly string[];
}

/** Runs inside the snapshot against files that the recorder wrote. It records console warnings as the observed warnings. */
const BLUEPRINT_ADAPTER = `const [root, requestPath] = Deno.args;
const request = JSON.parse(await Deno.readTextFile(requestPath));
const { IBlueprintLoader } = await import(new URL("file://" + root + "/packages/core/src/blueprint/blueprint_loader.ts").href);
const results = [];
for (const item of request.cases) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => { warnings.push(parts.join(" ")); };
  try {
    const loader = new IBlueprintLoader({ blueprintsPath: item.blueprintsPath, defaultModel: item.defaultModel ?? undefined });
    const loaded = await loader.load(item.role);
    results.push({ outcome: loaded === null ? "absent" : "loaded", loaded, name: "", message: "", warnings });
  } catch (error) {
    results.push({ outcome: "error", loaded: null, name: error.name, message: error.message, warnings });
  } finally {
    console.warn = originalWarn;
  }
}
console.log("${RESULT_PREFIX}" + JSON.stringify(results));
`;

function lastResult(output: string): string {
  const line = output.split("\n").findLast((text) => text.startsWith(RESULT_PREFIX));
  if (line === undefined) throw new Error("the pinned loader adapter printed no result");
  return line.slice(RESULT_PREFIX.length);
}

function relativeTo(root: string, text: string): string {
  return text.replaceAll(`${root}/`, "").replaceAll(root, ".");
}

function observeBlueprint(root: string, raw: IRawBlueprint): IBlueprintObservation {
  if (raw.outcome === "error") {
    const message = relativeTo(root, raw.message);
    return {
      outcome: "error",
      error: { kind: errorKind(raw.name, raw.message), message, paths: issuePaths(raw.message) },
      warnings: raw.warnings,
    };
  }
  if (raw.loaded === null) return { outcome: "absent", warnings: raw.warnings };
  return {
    outcome: "loaded",
    loaded: { ...raw.loaded, path: relativeTo(root, raw.loaded.path) },
    warnings: raw.warnings,
  };
}

/** Writes each authored file into its own case root and loads it with the real pinned blueprint loader. */
export const pinnedBlueprintRunner: TBlueprintRunner = async (
  snapshot: string,
  specs: readonly IBlueprintSpec[],
): Promise<readonly IBlueprintObservation[]> => {
  const scratch = await Deno.realPath(await Deno.makeTempDir({ prefix: "core-l1-blueprints-" }));
  try {
    const cases = [];
    for (const spec of specs) {
      const base = join(scratch, spec.id);
      const agents = join(base, "Blueprints", "Agents");
      await Deno.mkdir(agents, { recursive: true });
      if (spec.present) await Deno.writeTextFile(join(agents, `${spec.role}.md`), spec.content);
      cases.push({
        blueprintsPath: join(base, "Blueprints"),
        role: spec.role,
        defaultModel: spec.default_model,
      });
    }
    const raw: IRawBlueprint[] = JSON.parse(
      lastResult(await runPinnedAdapter(snapshot, BLUEPRINT_ADAPTER, JSON.stringify({ cases }), {})),
    );
    return raw.map((entry, index) => observeBlueprint(join(scratch, specs[index].id), entry));
  } finally {
    await Deno.remove(scratch, { recursive: true }).catch(() => {});
  }
};

/** Runs inside the snapshot. It prints the result of each load after it counts the pinned warnings. */
const CONTEXT_ADAPTER = `const [root, requestPath] = Deno.args;
const request = JSON.parse(await Deno.readTextFile(requestPath));
const { ContextLoader } = await import(new URL("file://" + root + "/packages/core/src/context/context_loader.ts").href);
const results = [];
for (const item of request.cases) {
  const loader = new ContextLoader({
    maxTokens: item.config.max_tokens,
    safetyMargin: item.config.safety_margin,
    truncationStrategy: item.config.truncation_strategy,
    perFileTokenCap: item.config.per_file_token_cap ?? undefined,
    isLocalAgent: item.config.is_local_agent,
  });
  results.push(await loader.loadWithLimit(item.paths));
}
console.log("${RESULT_PREFIX}" + JSON.stringify(results));
`;

function observeContext(root: string, raw: IContextObservation): IContextObservation {
  const relative = (text: string): string => relativeTo(root, text);
  return {
    content: relative(raw.content),
    warnings: raw.warnings.map(relative),
    totalTokens: raw.totalTokens,
    includedFiles: raw.includedFiles.map(relative),
    skippedFiles: raw.skippedFiles.map(relative),
    truncatedFiles: raw.truncatedFiles.map(relative),
  };
}

/** Writes each authored file tree with fixed modification times and loads it with the real pinned context loader. */
export const pinnedContextRunner: TContextRunner = async (
  snapshot: string,
  specs: readonly IContextSpec[],
): Promise<readonly IContextObservation[]> => {
  const scratch = await Deno.realPath(await Deno.makeTempDir({ prefix: "core-l1-context-" }));
  try {
    const cases = [];
    for (const spec of specs) {
      const base = join(scratch, spec.id);
      await Deno.mkdir(base, { recursive: true });
      for (const file of spec.files) {
        const path = join(base, file.path);
        await Deno.writeTextFile(path, file.content);
        const seconds = file.mtime_ms / 1000;
        await Deno.utime(path, seconds, seconds);
      }
      cases.push({ config: spec.config, paths: spec.requested.map((path) => join(base, path)) });
    }
    const raw: IContextObservation[] = JSON.parse(
      lastResult(await runPinnedAdapter(snapshot, CONTEXT_ADAPTER, JSON.stringify({ cases }), {})),
    );
    return raw.map((entry, index) => observeContext(join(scratch, specs[index].id), entry));
  } finally {
    await Deno.remove(scratch, { recursive: true }).catch(() => {});
  }
};

function checkCount(kind: string, expected: number, actual: number): void {
  if (expected !== actual) throw new Error(`the ${kind} runner returned ${actual} observations, expected ${expected}`);
}

interface IAuthoredCase {
  readonly id: string;
}

/** Pairs each authored case with the observation of the same position. */
function recordedCases(
  kind: string,
  specs: readonly IAuthoredCase[],
  observations: readonly object[],
): IRecordedLoaderCase[] {
  checkCount(kind, specs.length, observations.length);
  return specs.map((spec, index) => ({
    id: spec.id,
    input: `${JSON.stringify(spec, null, 2)}\n`,
    observation: `${JSON.stringify(observations[index], null, 2)}\n`,
  }));
}

/** Records the authored blueprint files. The case directory keeps the authored file and the observation. */
export async function recordBlueprintCases(
  snapshot: string,
  runner: TBlueprintRunner,
): Promise<IRecordedLoaderCase[]> {
  return recordedCases("blueprint", BLUEPRINT_SPECS, await runner(snapshot, BLUEPRINT_SPECS));
}

/** Records the authored context loads. */
export async function recordContextCases(snapshot: string, runner: TContextRunner): Promise<IRecordedLoaderCase[]> {
  return recordedCases("context", CONTEXT_SPECS, await runner(snapshot, CONTEXT_SPECS));
}
