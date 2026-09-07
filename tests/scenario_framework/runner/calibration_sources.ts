/**
 * @module ScenarioFrameworkCalibrationSources
 * @path tests/scenario_framework/runner/calibration_sources.ts
 * @description Phase 146 Step 1's real-artifact source reader: consumes an explicit
 *   `--source-index` JSON file of immutable evidence-snapshot pointers, validates each
 *   snapshot (hash integrity, required fields, real-run marker, redacted secrets), then
 *   deterministically selects a seeded sample for judge calibration. Never reconstructs
 *   evidence from current Workspace files or summary rows — a snapshot not on disk is
 *   simply unusable, not a fallback trigger.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/unit/calibration_sources_test.ts, packages/eval-history/src/calibration/identity.ts]
 */

import { isAbsolute, resolve } from "@std/path";
import { z } from "zod";
import {
  DEFAULT_CALIBRATION_MAX_ITEM_BYTES,
  DEFAULT_CALIBRATION_SAMPLE_COUNT,
  SHA256_HEX_PATTERN,
  sha256Hex,
} from "@exaix/eval-history";

export interface ICalibrationSourceIndexEntry {
  readonly run_id: string;
  readonly step_id: string;
  readonly snapshot_path: string;
  readonly snapshot_hash: string;
}

export interface ICalibrationEvidenceSnapshot {
  readonly request_context: string;
  readonly artifact: string;
  readonly rubric_methodology: string;
  readonly real_run_marker: true;
  readonly execution_status: string;
  readonly source_revision: string;
}

export interface ICalibrationSourceItem {
  readonly id: string;
  readonly runId: string;
  readonly stepId: string;
  readonly snapshot: ICalibrationEvidenceSnapshot;
}

export interface ICalibrationSourceExclusion {
  readonly id: string;
  readonly reason: string;
}

export interface ICalibrationSourceSelection {
  readonly selected: ICalibrationSourceItem[];
  readonly excluded: ICalibrationSourceExclusion[];
  readonly seed: string;
  readonly sourceIndexHash: string;
}

export interface IReadCalibrationSourcesOptions {
  readonly sourceIndexPath: string;
  readonly snapshotRoot: string;
  readonly seed: string;
  readonly sampleCount: number;
}

export class CalibrationSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationSourceError";
  }
}

export class CalibrationRedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationRedactionError";
  }
}

const SourceIndexEntrySchema = z.object({
  run_id: z.string().min(1),
  step_id: z.string().min(1),
  snapshot_path: z.string().min(1),
  snapshot_hash: z.string().regex(SHA256_HEX_PATTERN),
}).strict();

const SourceIndexSchema = z.array(SourceIndexEntrySchema);

const EvidenceSnapshotSchema = z.object({
  request_context: z.string().min(1),
  artifact: z.string().min(1),
  rubric_methodology: z.string().min(1),
  real_run_marker: z.literal(true),
  execution_status: z.string().min(1),
  source_revision: z.string().min(1),
}).strict();

const SECRET_ENV_NAME_PATTERN = /(API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH)/i;
const MIN_SECRET_VALUE_LENGTH = 8;
const REDACTED_PLACEHOLDER = "[REDACTED]";
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const AUTHORIZATION_HEADER_LINE_PATTERN = /\bAuthorization\s*:\s*[^\n]+/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+\S+/gi;
const CREDENTIAL_URL_USERINFO_PATTERN = /https?:\/\/[^\/\s:@]+:[^\/\s:@]+@/i;
const UNRESOLVED_SECRET_ASSIGNMENT_PATTERN = /\b(token|password|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{8,}["']?/i;

/** Redacts known-secret values, PEM private-key blocks, and Authorization/Bearer headers
 *  from `text`; throws {@link CalibrationRedactionError} if a token/password/api-key
 *  assignment or a credential-bearing URL survives redaction, rather than guessing. */
export function redactCalibrationSnapshot(text: string, ambientEnv: Record<string, string>): string {
  let result = text;

  for (const [name, value] of Object.entries(ambientEnv)) {
    if (value.length < MIN_SECRET_VALUE_LENGTH || !SECRET_ENV_NAME_PATTERN.test(name)) continue;
    result = result.split(value).join(REDACTED_PLACEHOLDER);
  }

  result = result.replace(PEM_PRIVATE_KEY_PATTERN, REDACTED_PLACEHOLDER);
  result = result.replace(AUTHORIZATION_HEADER_LINE_PATTERN, `Authorization: ${REDACTED_PLACEHOLDER}`);
  result = result.replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED_PLACEHOLDER}`);

  if (CREDENTIAL_URL_USERINFO_PATTERN.test(result)) {
    throw new CalibrationRedactionError("credential URL userinfo present after redaction");
  }
  if (UNRESOLVED_SECRET_ASSIGNMENT_PATTERN.test(result)) {
    throw new CalibrationRedactionError("unresolved token/password/api-key assignment present after redaction");
  }

  return result;
}

async function resolveContainedSnapshotPath(snapshotRoot: string, relativePath: string): Promise<string> {
  if (isAbsolute(relativePath)) {
    throw new CalibrationSourceError(`snapshot_path must be relative: "${relativePath}"`);
  }
  if (relativePath.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new CalibrationSourceError(`snapshot_path must not contain dot segments: "${relativePath}"`);
  }

  const realRoot = await Deno.realPath(resolve(snapshotRoot));
  const target = resolve(realRoot, relativePath);
  const realTarget = await Deno.realPath(target);

  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}/`)) {
    throw new CalibrationSourceError(`snapshot_path escapes the configured snapshot root: "${relativePath}"`);
  }

  return realTarget;
}

interface IValidatedSnapshot {
  readonly item: ICalibrationSourceItem;
}

async function validateSnapshot(
  entry: ICalibrationSourceIndexEntry,
  snapshotRoot: string,
  ambientEnv: Record<string, string>,
): Promise<IValidatedSnapshot> {
  const realPath = await resolveContainedSnapshotPath(snapshotRoot, entry.snapshot_path);

  const stat = await Deno.stat(realPath);
  if (stat.size > DEFAULT_CALIBRATION_MAX_ITEM_BYTES) {
    throw new CalibrationSourceError(`snapshot exceeds the configured size limit: "${entry.snapshot_path}"`);
  }

  const raw = await Deno.readTextFile(realPath);
  const digest = await sha256Hex(raw);
  if (digest !== entry.snapshot_hash) {
    throw new CalibrationSourceError(`snapshot content hash does not match snapshot_hash: "${entry.snapshot_path}"`);
  }

  const parsed = EvidenceSnapshotSchema.parse(JSON.parse(raw));

  const snapshot: ICalibrationEvidenceSnapshot = {
    ...parsed,
    request_context: redactCalibrationSnapshot(parsed.request_context, ambientEnv),
    artifact: redactCalibrationSnapshot(parsed.artifact, ambientEnv),
    rubric_methodology: redactCalibrationSnapshot(parsed.rubric_methodology, ambientEnv),
  };

  return {
    item: { id: entry.snapshot_hash, runId: entry.run_id, stepId: entry.step_id, snapshot },
  };
}

/** Reads, validates, and seed-selects real snapshots from an explicit `--source-index`
 *  file; a failing entry is excluded with a reason, never reconstructed or repaired. */
export async function readCalibrationSources(
  options: IReadCalibrationSourcesOptions,
): Promise<ICalibrationSourceSelection> {
  const rawIndex = await Deno.readTextFile(options.sourceIndexPath);
  const entries = SourceIndexSchema.parse(JSON.parse(rawIndex));
  const sourceIndexHash = await sha256Hex(rawIndex);
  const ambientEnv = Deno.env.toObject();

  const excluded: ICalibrationSourceExclusion[] = [];
  const seenIds = new Set<string>();
  const candidates: ICalibrationSourceIndexEntry[] = [];

  for (const entry of entries) {
    if (seenIds.has(entry.snapshot_hash)) {
      excluded.push({ id: entry.snapshot_hash, reason: "duplicate-id" });
      continue;
    }
    seenIds.add(entry.snapshot_hash);
    candidates.push(entry);
  }

  const eligible: ICalibrationSourceItem[] = [];
  for (const entry of candidates) {
    try {
      const { item } = await validateSnapshot(entry, options.snapshotRoot, ambientEnv);
      eligible.push(item);
    } catch (error) {
      const reason = error instanceof CalibrationRedactionError
        ? "unredactable-secret"
        : error instanceof Deno.errors.NotFound
        ? "snapshot-not-found"
        : error instanceof z.ZodError
        ? "missing-context"
        : "invalid-snapshot";
      excluded.push({ id: entry.snapshot_hash, reason });
    }
  }

  const requiredMinimum = DEFAULT_CALIBRATION_SAMPLE_COUNT;
  if (eligible.length < requiredMinimum) {
    throw new CalibrationSourceError(
      `Only ${eligible.length} eligible calibration snapshot(s) found (need at least ${requiredMinimum}). ` +
        `Run \`exactl eval run\` on the real Phase 141 pack with --capture-calibration-evidence enabled to collect more.`,
    );
  }

  const ranked = await Promise.all(
    eligible.map(async (item) => ({ item, rank: await sha256Hex(`${options.seed}${item.id}`) })),
  );
  ranked.sort((left, right) => left.rank.localeCompare(right.rank));

  const takeCount = Math.min(options.sampleCount, ranked.length);
  const selected = ranked.slice(0, takeCount).map((entry) => entry.item);
  for (const entry of ranked.slice(takeCount)) {
    excluded.push({ id: entry.item.id, reason: "not-selected" });
  }

  return { selected, excluded, seed: options.seed, sourceIndexHash };
}
