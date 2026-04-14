#!/usr/bin/env -S deno run -A
/**
 * @module CheckCommitMsg
 * @path scripts/check_commit_msg.ts
 * @description Validates structured commit messages against Exaix guidelines.
 *
 * Usage:
 *   deno run -A scripts/check_commit_msg.ts <commit_msg_file>
 */

/** Standard conventional commit types. */
const VALID_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const REQUIRED_FIELDS = ["what", "rationale", "tests", "who", "impact"];

/** Known valid models to prevent hallucinations (can be extended). */
const VALID_MODELS = [
  "Gemini",
  "Claude",
  "GPT",
  "Antigravity",
  "Ollama",
  "Llama",
];

/**
 * Validates a commit message string.
 * @param text The full commit message.
 * @param options Validation options including changed file count for metrics.
 * @returns Object with success status and list of error messages.
 */
export function validateCommitMsg(
  text: string,
  options: { changedFileCount?: number } = {},
): { success: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split("\n");

  if (lines.length === 0 || !lines[0].trim()) {
    return { success: false, errors: ["Commit message is empty."] };
  }

  const subject = lines[0].trim();

  // 1. Skip validation for auto-generated commits
  if (
    subject.startsWith("Merge branch") ||
    subject.startsWith("Merge remote-tracking branch") ||
    subject.startsWith("Revert ") ||
    subject.startsWith("fixup! ") ||
    subject.startsWith("squash! ")
  ) {
    return { success: true, errors: [] };
  }

  // 2. Validate Conventional Commit prefix
  const typeMatch = subject.match(/^(\w+)(?:\(.+\))?!?: /);
  if (!typeMatch) {
    errors.push(
      `Subject line does not follow conventional commit format: "<type>(<scope>): <summary>".`,
    );
  } else {
    const type = typeMatch[1];
    if (!VALID_TYPES.includes(type)) {
      errors.push(`Invalid commit type "${type}". Allowed types: ${VALID_TYPES.join(", ")}.`);
    }
  }

  // 3. Extract fields and validate
  const fieldMap = new Map<string, string>();
  let currentField: string | null = null;
  let currentContent: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const fieldMatch = line.match(/^(\w+):\s*(.*)/);

    if (fieldMatch) {
      if (currentField) {
        fieldMap.set(currentField, currentContent.join("\n").trim());
      }
      currentField = fieldMatch[1].toLowerCase();
      currentContent = [fieldMatch[2]];
    } else if (currentField) {
      currentContent.push(line);
    }
  }
  if (currentField) {
    fieldMap.set(currentField, currentContent.join("\n").trim());
  }

  for (const field of REQUIRED_FIELDS) {
    if (!fieldMap.has(field)) {
      errors.push(`Missing required field: "${field}:".`);
    } else if (!fieldMap.get(field)) {
      errors.push(`Required field "${field}:" cannot be empty.`);
    }
  }

  const what = fieldMap.get("what") || "";
  const rationale = fieldMap.get("rationale") || "";
  const impact = fieldMap.get("impact") || "";

  // 4. Specific Impact validation & Component Traceability
  if (impact) {
    // Requirement: <component>: <details>
    if (!impact.includes(":")) {
      errors.push(
        `Impact field must follow the format "<component>: <details>" (e.g., "ReqProc: added validation").`,
      );
    } else {
      // Component Traceability: Every component must appear in 'what'.
      // Multi-component entries are separated by semicolons:
      //   "CompA: details; CompB: more details"
      // Segments without a colon are plain continuation text, not component names.
      const components = impact
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.includes(":"))
        .map((s) => s.split(":")[0].trim());
      for (const comp of components) {
        if (comp && !what.toLowerCase().includes(comp.toLowerCase())) {
          errors.push(
            `Component Traceability failed: Component "${comp}" mentioned in impact but missing from the "what:" explanation.`,
          );
        }
      }
    }
  }

  // 5. Model validation (hallucination check)
  if (fieldMap.has("model")) {
    const model = fieldMap.get("model")!;
    const isKnown = VALID_MODELS.some((m) => model.toLowerCase().includes(m.toLowerCase()));
    if (!isKnown && model.trim() !== "") {
      errors.push(
        `Model "${model}" appears to be hallucinated or unknown. Use a real model name (e.g., Gemini, Claude, Antigravity).`,
      );
    }
  }

  // 6. Metrics: Structural Bloom
  const changedFileCount = options.changedFileCount || 0;
  if (changedFileCount > 3) {
    // Count bullet points starting with - or * followed by a space
    const bulletRegex = /^[ \t]*[-*] /gm;
    const bullets = (what.match(bulletRegex) || []).length;
    if (bullets < 2) {
      errors.push(
        `Structural Bloom: Changes affect ${changedFileCount} files. Please use at least two bullet points in the "what:" section to break down the changes.`,
      );
    }
  }

  // 7. Metrics: Density Threshold
  const combined = (what + " " + rationale).trim();
  const words = combined.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  // Threshold: 5 words per file, capped at 50
  const requiredWords = Math.min(50, changedFileCount * 5);
  if (wordCount < requiredWords) {
    errors.push(
      `Density Threshold: Your description is only ${wordCount} words. Based on ${changedFileCount} files changed, at least ${requiredWords} words of detail (across what/rationale) are required.`,
    );
  }

  return { success: errors.length === 0, errors };
}

/** CLI Entry point */
if (import.meta.main) {
  const commitMsgFile = Deno.args[0];
  if (!commitMsgFile) {
    console.error("Usage: deno run scripts/check_commit_msg.ts <commit-msg-file>");
    Deno.exit(1);
  }

  try {
    const text = Deno.readTextFileSync(commitMsgFile);

    // Try to get changed file count from git if available
    let changedFileCount = 0;
    try {
      const process = new Deno.Command("git", {
        args: ["diff", "--cached", "--name-only"],
        stdout: "piped",
      });
      const output = await process.output();
      const files = new TextDecoder().decode(output.stdout).trim();
      changedFileCount = files ? files.split("\n").length : 0;
    } catch (_e) {
      // Not in a git repo or git not found, default to 0
    }

    const { success, errors } = validateCommitMsg(text, { changedFileCount });

    if (!success) {
      console.error("\n❌ Structured Commit Message Validation Failed:");
      errors.forEach((e) => console.error(`  - ${e}`));
      console.error("\nExpected format:");
      console.error("  feat: subject line\n");
      console.error("  what: detailed explanation");
      console.error("  rationale: why this change");
      console.error("  tests: summary status");
      console.error("  who: agent or user name");
      console.error("  impact: ArchitectureComponent: brief details");
      console.error("\nOptional: conversation_id, links, prompt, tool_audit, model\n");
      Deno.exit(1);
    }

    console.log("✅ Commit message structure valid.");
    Deno.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error processing commit message: ${msg}`);
    Deno.exit(1);
  }
}
