#!/usr/bin/env -S deno run -A
/**
 * @module PlanToRequests
 * @path scripts/plan_to_requests.ts
 * @description Reads a phase-NN-*.md planning document and generates one request
 *   file per step into Workspace/Requests/. Supports YAML step-manifests and
 *   heading-scrape fallback.
 * @architectural-layer Script
 * @dependencies [@exaix/schemas, @std/path, @std/fs, @std/yaml]
 * @related-files [packages/schemas/src/step_manifest.ts, packages/schemas/src/request.ts]
 * Usage: plan_to_requests.ts <plan_path> [--out-dir <dir>] [--dry-run]
 */

import { basename, extname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";
import { type StepManifest, StepManifestSchema } from "@exaix/schemas/step_manifest.ts";
import { RequestSchema } from "@exaix/schemas/request.ts";

interface ParsedStep {
  stepNumber: number;
  sectionText: string;
}

interface FrontmatterFields {
  trace_id: string;
  identity_id: string;
  status: string;
  priority: number;
  tags: string[];
  skills?: string[];
}

function parseArgs(): { planPath: string; outDir: string; dryRun: boolean } {
  const args = Deno.args;
  if (args.length === 0) {
    console.error("Usage: plan_to_requests.ts <plan_path> [--out-dir <dir>] [--dry-run]");
    Deno.exit(1);
  }
  const planPath = args[0];
  let outDir = "Workspace/Requests";
  let dryRun = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--out-dir" && i + 1 < args.length) {
      outDir = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { planPath, outDir, dryRun };
}

function derivePlanSlug(planPath: string): string {
  const base = basename(planPath, extname(planPath));
  return base;
}

function extractSteps(content: string): ParsedStep[] {
  const stepRegex = /^#{2,3}\s+Step\s+(\d+)/gm;
  const steps: ParsedStep[] = [];
  const seen = new Set<number>();
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let lastStepNumber = 0;

  while ((match = stepRegex.exec(content)) !== null) {
    const stepNumber = parseInt(match[1], 10);
    if (seen.has(stepNumber)) {
      console.error(`Duplicate step number ${stepNumber}; each step must have a unique number.`);
      Deno.exit(1);
    }
    seen.add(stepNumber);

    if (lastIndex > 0) {
      steps.push({ stepNumber: lastStepNumber, sectionText: content.slice(lastIndex, match.index).trim() });
    }
    lastIndex = match.index;
    lastStepNumber = stepNumber;
  }

  if (lastIndex > 0) {
    steps.push({ stepNumber: lastStepNumber, sectionText: content.slice(lastIndex).trim() });
  }

  if (steps.length === 0) {
    console.error("No step headings found in plan file; each step must start with '## Step N' or '### Step N'.");
    Deno.exit(1);
  }

  return steps.sort((a, b) => a.stepNumber - b.stepNumber);
}

function extractManifest(sectionText: string): StepManifest | null {
  const yamlMatch = sectionText.match(/```yaml\s*\n([\s\S]*?)```/);
  if (!yamlMatch) return null;

  const yamlBlock = yamlMatch[1];
  // Check for step-manifest marker
  if (!yamlBlock.includes("# step-manifest")) return null;

  try {
    const parsed = parseYaml(yamlBlock);
    if (typeof parsed !== "object" || parsed === null) return null;
    const result = StepManifestSchema.safeParse(parsed);
    if (result.success) return result.data;
    console.warn(`Manifest failed validation: ${result.error.message}; falling back to heading scrape`);
    return null;
  } catch {
    console.warn("YAML parse error; falling back to heading scrape");
    return null;
  }
}

function extractSection(text: string, heading: string): string {
  const regex = new RegExp(`\\*\\*${heading}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|\\n---|$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function buildRequestFile(
  planSlug: string,
  stepNumber: number,
  manifest: StepManifest | null,
  sectionText: string,
): string {
  const identityId = manifest?.identity ?? "senior-coder";
  const skills = manifest?.skills;
  const portal = manifest?.portal ?? "exaix-self";
  const targetBranch = manifest?.target_branch ?? `feat/${planSlug}-step-${stepNumber}`;
  const title = manifest?.title ?? `Step ${stepNumber}`;
  const dependsOn = manifest?.depends_on ?? (stepNumber > 1 ? [stepNumber - 1] : []);
  const priority = Math.max(0, Math.min(10, 10 - stepNumber));
  const tags = [planSlug, `step-${stepNumber}`, "dogfood"];

  // Build body from manifest acceptance or scrape
  const actionsText = extractSection(sectionText, "Actions");
  const archNotes = extractSection(sectionText, "Architecture Notes");
  const plannedTests = extractSection(sectionText, "Planned Tests");
  const successCriteria = extractSection(sectionText, "Success Criteria");

  const bodyParts: string[] = [];
  if (actionsText) bodyParts.push(`## Actions\n\n${actionsText}`);
  if (archNotes) bodyParts.push(`## Architecture Notes\n\n${archNotes}`);
  if (plannedTests) bodyParts.push(`## Planned Tests\n\n${plannedTests}`);
  if (successCriteria) bodyParts.push(`## Success Criteria\n\n${successCriteria}`);

  const bodyLines: string[] = [
    `# ${title}`,
    "",
    `> Dogfood metadata — portal: \`${portal}\`; target_branch: \`${targetBranch}\``,
    "",
    ...bodyParts,
    "",
    `depends_on: ${JSON.stringify(dependsOn)}`,
  ];

  const frontmatter: FrontmatterFields = {
    trace_id: crypto.randomUUID(),
    identity_id: identityId,
    status: "pending",
    priority,
    tags,
  };
  if (skills) frontmatter.skills = skills;

  // Validate against RequestSchema before assembling
  const validation = RequestSchema.safeParse(frontmatter);
  if (!validation.success) {
    console.error(`Step ${stepNumber}: frontmatter fails RequestSchema: ${validation.error.message}`);
    Deno.exit(1);
  }

  const fmYamlLines = Object.entries(frontmatter).map(([k, v]) => {
    if (Array.isArray(v)) return `  ${k}:\n${v.map((item: string) => `    - ${item}`).join("\n")}`;
    return `  ${k}: ${JSON.stringify(v)}`;
  });

  return `---\n${fmYamlLines.join("\n")}\n---\n\n${bodyLines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const { planPath, outDir, dryRun } = parseArgs();

  let content: string;
  try {
    content = await Deno.readTextFile(planPath);
  } catch {
    console.error(`Error: plan file not found or unreadable: ${planPath}`);
    Deno.exit(1);
  }

  const planSlug = derivePlanSlug(planPath);
  const steps = extractSteps(content);
  if (!dryRun) {
    await ensureDir(outDir);
  }

  let writtenCount = 0;
  for (const step of steps) {
    const manifest = extractManifest(step.sectionText);
    const fileName = `${planSlug}-step-${step.stepNumber}.md`;
    const filePath = join(outDir, fileName);
    const requestContent = buildRequestFile(planSlug, step.stepNumber, manifest, step.sectionText);

    if (dryRun) {
      console.log(
        `Would write: ${filePath} (identity: ${manifest?.identity ?? "senior-coder"}, priority: ${
          Math.max(0, Math.min(10, 10 - step.stepNumber))
        })`,
      );
    } else {
      // Atomic write: temp + rename
      const tmpPath = filePath + ".tmp";
      await Deno.writeTextFile(tmpPath, requestContent);
      await Deno.rename(tmpPath, filePath);
    }
    writtenCount++;
  }

  console.log(`${dryRun ? "Would write" : "Wrote"} ${writtenCount} request file(s) to ${outDir}`);
}

if (import.meta.main) {
  main();
}
