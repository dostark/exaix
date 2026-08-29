/**
 * @module PhaseStepManifestParser
 * @path packages/flow/src/phase_step_manifest_parser.ts
 * @description Package-pure parser for phase-NN-*.md planning documents: splits the
 *   document into per-step sections by `## Step N` / `### Step N` headings and extracts
 *   each section's optional fenced YAML step-manifest. Performs no filesystem, console,
 *   or process-exit access — `scripts/plan_to_requests.ts` is the sole I/O adapter.
 * @architectural-layer Flows
 * @dependencies [zod, @std/yaml, @exaix/schemas]
 * @related-files [scripts/plan_to_requests.ts, packages/schemas/src/step_manifest.ts]
 */

import { parse as parseYaml } from "@std/yaml";
import { type StepManifest, StepManifestSchema } from "@exaix/schemas/step_manifest.ts";

export type PhaseStepDiagnosticCode =
  | "missing_step_heading"
  | "missing_manifest"
  | "invalid_manifest_yaml"
  | "invalid_manifest_schema"
  | "duplicate_step_number"
  | "non_contiguous_step_number"
  | "no_steps";

export interface IPhaseStepDiagnostic {
  readonly code: PhaseStepDiagnosticCode;
  readonly message: string;
  readonly stepNumber?: number;
}

export interface IParsedPhaseStep {
  readonly stepNumber: number;
  readonly sectionText: string;
  readonly manifest: StepManifest | null;
}

export interface IPhaseStepManifestParseResult {
  readonly steps: IParsedPhaseStep[];
  readonly diagnostics: IPhaseStepDiagnostic[];
}

const STEP_HEADING_REGEX = /^#{2,3}\s+Step\s+(\d+)/gm;
const MANIFEST_FENCE_REGEX = /```yaml\s*\n([\s\S]*?)```/;
const STEP_MANIFEST_MARKER = "# step-manifest";

/** Parses one step section's fenced ```yaml step-manifest block, if any. */
function parseStepManifest(sectionText: string, stepNumber: number): {
  manifest: StepManifest | null;
  diagnostic?: IPhaseStepDiagnostic;
} {
  const fenceMatch = sectionText.match(MANIFEST_FENCE_REGEX);
  if (!fenceMatch || !fenceMatch[1].includes(STEP_MANIFEST_MARKER)) {
    return {
      manifest: null,
      diagnostic: {
        code: "missing_manifest",
        message: `Step ${stepNumber} has no fenced step-manifest block; falling back to heading scrape`,
        stepNumber,
      },
    };
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(fenceMatch[1]);
  } catch {
    return {
      manifest: null,
      diagnostic: {
        code: "invalid_manifest_yaml",
        message: `Step ${stepNumber}: YAML parse error in step-manifest block; falling back to heading scrape`,
        stepNumber,
      },
    };
  }

  if (typeof parsedYaml !== "object" || parsedYaml === null) {
    return {
      manifest: null,
      diagnostic: {
        code: "invalid_manifest_yaml",
        message: `Step ${stepNumber}: step-manifest block did not parse to an object; falling back to heading scrape`,
        stepNumber,
      },
    };
  }

  const result = StepManifestSchema.safeParse(parsedYaml);
  if (!result.success) {
    return {
      manifest: null,
      diagnostic: {
        code: "invalid_manifest_schema",
        message:
          `Step ${stepNumber}: manifest failed validation: ${result.error.message}; falling back to heading scrape`,
        stepNumber,
      },
    };
  }

  if (result.data.step !== stepNumber) {
    return {
      manifest: result.data,
      diagnostic: {
        code: "missing_step_heading",
        message:
          `Step ${stepNumber}: manifest declares step ${result.data.step}, which does not match its own heading number ${stepNumber}`,
        stepNumber,
      },
    };
  }

  return { manifest: result.data };
}

/**
 * Splits `content` into ordered per-step sections at `## Step N` / `### Step N`
 * headings and parses each section's fenced step-manifest. Pure: no I/O, no console,
 * no `Deno.exit`. Callers map `diagnostics` to their own warning/error/exit policy.
 */
export function parsePhaseStepManifests(content: string): IPhaseStepManifestParseResult {
  const diagnostics: IPhaseStepDiagnostic[] = [];
  const rawSections: Array<{ stepNumber: number; sectionText: string }> = [];
  const seen = new Set<number>();
  let match: RegExpExecArray | null;
  // -1 (not 0) is the "no step seen yet" sentinel: a plan whose first step heading sits
  // at offset 0 would otherwise have that step silently dropped.
  let lastIndex = -1;
  let lastStepNumber = 0;
  STEP_HEADING_REGEX.lastIndex = 0;

  while ((match = STEP_HEADING_REGEX.exec(content)) !== null) {
    const stepNumber = parseInt(match[1], 10);
    if (seen.has(stepNumber)) {
      diagnostics.push({
        code: "duplicate_step_number",
        message: `Duplicate step number ${stepNumber}; each step must have a unique number.`,
        stepNumber,
      });
    }
    seen.add(stepNumber);

    if (lastIndex >= 0) {
      rawSections.push({ stepNumber: lastStepNumber, sectionText: content.slice(lastIndex, match.index).trim() });
    }
    lastIndex = match.index;
    lastStepNumber = stepNumber;
  }
  if (lastIndex >= 0) {
    rawSections.push({ stepNumber: lastStepNumber, sectionText: content.slice(lastIndex).trim() });
  }

  rawSections.sort((a, b) => a.stepNumber - b.stepNumber);

  if (rawSections.length === 0) {
    diagnostics.push({
      code: "no_steps",
      message: "No step headings found in plan file; each step must start with '## Step N' or '### Step N'.",
    });
    return { steps: [], diagnostics };
  }

  for (let i = 1; i < rawSections.length; i++) {
    const expected = rawSections[i - 1].stepNumber + 1;
    if (rawSections[i].stepNumber !== expected) {
      diagnostics.push({
        code: "non_contiguous_step_number",
        message: `Step numbers are non-contiguous: expected ${expected} after ${rawSections[i - 1].stepNumber}, found ${
          rawSections[i].stepNumber
        }`,
        stepNumber: rawSections[i].stepNumber,
      });
    }
  }

  const steps: IParsedPhaseStep[] = rawSections.map(({ stepNumber, sectionText }) => {
    const { manifest, diagnostic } = parseStepManifest(sectionText, stepNumber);
    if (diagnostic) diagnostics.push(diagnostic);
    return { stepNumber, sectionText, manifest };
  });

  return { steps, diagnostics };
}
