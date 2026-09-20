/**
 * @module PersonaResponseEvidence
 * @path tests/scenario_framework/runner/persona_response_evidence.ts
 * @description Captures accepted role content and journal provenance for blinded persona scoring.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/persona_response_evidence_test.ts]
 */
import { Database } from "@db/sqlite";
import type { Opt, Reason } from "@exaix/core/types";
import type { Config } from "@exaix/schemas";
import { PathResolver } from "@exaix/portal";
import { OutputValidator } from "@exaix/tool-runtime";
import { ensureDir, walk } from "@std/fs";
import { dirname, isAbsolute, relative } from "@std/path";
import { z } from "zod";
import type { PersonaVariant } from "./persona_isolation_arm.ts";

export interface IPersonaResponseCaptureInput {
  config: Config;
  traceId: string;
  agentRole: string;
  provider: string;
  model: string;
  baselineRowid: number;
  experimentId: string;
  taskId: string;
  trialIndex: number;
  variant: PersonaVariant;
  runId: string;
  outputAlias: string;
}

export interface IPersonaRoleResponseEvidence {
  traceId: string;
  agentRole: string;
  provider: string;
  model: string;
  experimentId: string;
  taskId: string;
  trialIndex: number;
  variant: PersonaVariant;
  runId: string;
  responseRowid: number;
  planPath: string;
  content: string;
  contentHash: string;
  rawResponseHash: string;
}

/** A source path relative to one declared portal alias's root. */
export interface IPersonaJudgeContextFile {
  alias: string;
  path: string;
}

const JournalPayloadSchema = z.object({
  agent_role: z.string().optional(),
  full_response: z.string().optional(),
  stop_reason: z.string().nullable().optional(),
  plan_path: z.string().optional(),
  model: z.string().nullable().optional(),
});
type JournalPayload = z.infer<typeof JournalPayloadSchema>;
interface IResponseJournalRow {
  rowid: number;
  action_type: string;
  payload: string;
}
interface IParsedResponseJournalRow extends IResponseJournalRow {
  parsed: JournalPayload;
}
const UUID_SCHEMA = z.string().uuid();
const TRUNCATED_STOP_REASONS = new Set(["max_tokens", "length"]);
const PERSONA_CONTEXT_ALIAS = "@Memory/persona-judge-context.txt";
const SOURCE_FILE_SUFFIX = ".ts";

/** Freezes initial fixture source and the task, withholding experimental persona metadata. */
export async function preparePersonaJudgeContext(
  config: Config,
  request: string,
  portalAliases: string[],
  relevantFiles?: Opt<readonly IPersonaJudgeContextFile[], Reason.OptionalInput>,
): Promise<string> {
  const resolver = new PathResolver(config);
  const sections = [`Task:\n${request}`];
  for (const file of relevantFiles ?? []) {
    if (!portalAliases.includes(file.alias) || !file.path || isAbsolute(file.path) || file.path.startsWith("@")) {
      throw new Error("Judge context file must be relative to a declared portal alias");
    }
  }
  for (const alias of [...portalAliases].sort()) {
    const root = await resolver.resolve(alias);
    const files: string[] = [];
    if (relevantFiles) {
      files.push(...relevantFiles.filter((file) => file.alias === alias).map((file) => file.path));
    } else {
      for await (const entry of walk(root, { includeDirs: false, skip: [/\/.git(?:\/|$)/] })) {
        if (entry.isFile && entry.path.endsWith(SOURCE_FILE_SUFFIX)) files.push(relative(root, entry.path));
      }
    }
    for (const file of files.sort()) {
      const path = await resolver.resolve(`${alias}/${file}`);
      if (relevantFiles) {
        const relativeTarget = relative(await Deno.realPath(root), await Deno.realPath(path));
        if (relativeTarget === ".." || relativeTarget.startsWith("../") || isAbsolute(relativeTarget)) {
          throw new Error("Judge context file is outside the target portal alias root");
        }
      }
      sections.push(`Source ${alias}/${file}:\n${await Deno.readTextFile(path)}`);
    }
  }
  const path = await resolver.resolve(PERSONA_CONTEXT_ALIAS);
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, sections.join("\n\n"), { createNew: true });
  return path;
}

/** Resolves paths before reading and writes immutable, content-addressed response evidence. */
export async function capturePersonaRoleResponse(
  input: IPersonaResponseCaptureInput,
): Promise<IPersonaRoleResponseEvidence> {
  UUID_SCHEMA.parse(input.traceId);
  UUID_SCHEMA.parse(input.runId);
  z.number().int().nonnegative().parse(input.baselineRowid);
  z.number().int().nonnegative().parse(input.trialIndex);
  for (const pin of [input.agentRole, input.provider, input.model, input.experimentId, input.taskId]) {
    z.string().trim().min(1).parse(pin);
  }
  const resolver = new PathResolver(input.config);
  const journalPath = await resolver.resolve("@Runtime/journal.db");
  const outputPath = await resolver.resolve(input.outputAlias);
  const db = new Database(journalPath, { readonly: true });
  let rows: IParsedResponseJournalRow[];
  try {
    rows = db.prepare(
      "SELECT rowid, action_type, payload FROM activity WHERE trace_id = ? AND rowid > ? ORDER BY rowid",
    ).all<IResponseJournalRow>(input.traceId, input.baselineRowid)
      .map((row) => ({ ...row, parsed: JournalPayloadSchema.parse(JSON.parse(row.payload)) }));
  } finally {
    db.close();
  }
  const { response, planPath } = selectAcceptedResponse(rows, input);
  const raw = response.parsed.full_response!;
  const content = new OutputValidator().parseXMLTags(raw).content;
  if (!content.trim()) throw new Error("Accepted role response has no content");
  const evidence: IPersonaRoleResponseEvidence = {
    traceId: input.traceId,
    agentRole: input.agentRole,
    provider: input.provider,
    model: input.model,
    experimentId: input.experimentId,
    taskId: input.taskId,
    trialIndex: input.trialIndex,
    variant: input.variant,
    runId: input.runId,
    responseRowid: response.rowid,
    planPath,
    content,
    contentHash: await hash(content),
    rawResponseHash: await hash(raw),
  };
  await ensureDir(dirname(outputPath));
  const serialized = JSON.stringify(evidence, null, 2);
  try {
    await Deno.writeTextFile(outputPath, serialized, { createNew: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    if (await Deno.readTextFile(outputPath) !== serialized) {
      throw new Error("Persona response evidence already exists with different provenance");
    }
  }
  return evidence;
}

function selectAcceptedResponse(rows: IParsedResponseJournalRow[], input: IPersonaResponseCaptureInput) {
  const planned = rows.filter((row) => row.action_type === "request.planned");
  if (planned.length !== 1) throw new Error("Expected exactly one accepted request plan");
  const plan = planned[0];
  const created = rows.filter((row) =>
    row.action_type === "plan.created" && row.rowid < plan.rowid &&
    row.parsed.plan_path === plan.parsed.plan_path
  );
  if (created.length !== 1 || !plan.parsed.plan_path) throw new Error("Missing or ambiguous plan provenance");
  const completed = rows.filter((row) =>
    row.action_type === "agent.execution_completed" && row.parsed.agent_role === input.agentRole &&
    row.rowid < created[0].rowid
  );
  const completion = completed.at(-1);
  if (!completion) throw new Error("Missing accepted role completion");
  const lowerBound = completed.at(-2)?.rowid ?? input.baselineRowid;
  const responses = rows.filter((row) =>
    row.action_type === "agent.llm_response_received" && row.parsed.agent_role === input.agentRole &&
    row.rowid > lowerBound && row.rowid < completion.rowid
  );
  if (responses.length !== 1) throw new Error("Missing or ambiguous accepted role response");
  const response = responses[0];
  if (!response.parsed.full_response || TRUNCATED_STOP_REASONS.has(response.parsed.stop_reason ?? "")) {
    throw new Error("Missing or truncated role response");
  }
  const call = rows.filter((row) =>
    row.action_type === "llm.call.completed" && row.rowid > lowerBound && row.rowid < response.rowid
  ).at(-1);
  const expectedModels = new Set([
    `${input.provider}:${input.model}`,
    `${input.provider}-${input.provider}:${input.model}`,
    `${input.provider}-${input.model}`,
  ]);
  if (!call?.parsed.model || !expectedModels.has(call.parsed.model)) {
    throw new Error("Role response provider/model provenance differs from the pinned cell");
  }
  return { response, planPath: plan.parsed.plan_path };
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
