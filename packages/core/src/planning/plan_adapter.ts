/**
 * @module PlanAdapter
 * @path packages/core/src/planning/plan_adapter.ts
 * @description JSON validation and markdown conversion for LLM plans.
 *
 * Responsibilities:
 * 1. Parse and validate JSON plan output from LLMs
 * 2. Convert validated Plan objects to readable markdown
 * 3. Provide structured error reporting for validation failures
 *
 * @architectural-layer Services
 * @related-files ["packages/core/src/planning/plan_writer.ts", "packages/tool-runtime/src/output_validator.ts"]
 */

import { type IPlanAction, type Plan, PlanSchema } from "@exaix/schemas/plan_schema.ts";
import { createOutputValidator, type IValidationMetrics, type OutputValidator } from "@exaix/tool-runtime";
import { describeSchema } from "@exaix/schemas/schema_describer.ts";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { extractTomlActionBlocks } from "./toml_action_blocks.ts";
import { tryParseXmlPlan } from "./xml_plan_parser.ts";

// ============================================================================
// Types
// ============================================================================

interface QACase {
  scenario: string;
  setup: string;
  steps: string[];
  expectedResult: string;
  status: string;
  notes?: string;
}

interface E2ECase {
  journey: string;
  scenario: string;
  preconditions: string;
  steps: string[];
  verificationPoints: string[];
  status: string;
}

/** Minimal shape read from a JSON envelope during TOML_BLOCK:N sentinel substitution — the
 *  envelope is not yet Zod-validated at this point, so fields are read defensively. */
interface IEnvelopeWithSteps {
  steps?: JSONValue;
}

/** A single step entry within IEnvelopeWithSteps.steps, before Zod validation. */
interface IEnvelopeStep {
  actions?: JSONValue;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when plan validation fails
 */
export class PlanValidationError extends Error {
  constructor(
    message: string,
    public details: Record<string, JSONValue>,
  ) {
    super(message);
    this.name = "PlanValidationError";
  }
}

// ============================================================================
// Plan Adapter Service
// ============================================================================

/**
 * PlanAdapter validates JSON plans and converts them to markdown
 */
export class PlanAdapter {
  private validator: OutputValidator;

  constructor() {
    this.validator = createOutputValidator({ autoRepair: true });
  }

  /**
   * Parse and validate LLM plan content as JSON
   * @param content - Raw LLM content from <content> tags
   * @returns Validated Plan object
   * @throws PlanValidationError if JSON is invalid or doesn't match schema
   */
  parse(content: string): Plan {
    const trimmed = content.trim();

    // Phase 141 Step 3a: strip prose around structured spans before parsing.
    // LLMs commonly wrap structured output in prose ("I've added...\n<plan>...\n</plan>\nDone").
    // Extract the first <plan>...</plan> span for XML path, or rely on extractJsonObjectSpan
    // in json_repair.ts for the JSON path.

    // Try to extract <plan>...</plan> span (non-greedy, first occurrence)
    const planMatch = trimmed.match(/<plan>[\s\S]*?<\/plan>/);
    const xmlContent = planMatch ? planMatch[0] : null;

    if (xmlContent) {
      const xmlResult = tryParseXmlPlan(xmlContent);
      if (xmlResult.success) {
        const validated = PlanSchema.safeParse(xmlResult.plan);
        if (validated.success) {
          return validated.data;
        }
        console.error(`[PlanAdapter] XML plan failed PlanSchema validation: ${JSON.stringify(validated.error.issues)}`);
      } else {
        console.error(`[PlanAdapter] XML plan parse failed: ${xmlResult.error}`);
      }
      // Fall through to JSON parsing if XML fails
    }

    const { envelope, actionsByBlock } = extractTomlActionBlocks(content);

    if (actionsByBlock.size === 0) {
      return this.parsePureJson(content);
    }

    return this.parseWithTomlActionBlocks(envelope, actionsByBlock, content);
  }

  private parsePureJson(content: string): Plan {
    const result = this.validator.validate(content, PlanSchema);

    if (result.success && result.value) {
      return result.value;
    }

    // Debug: log full model response when plan validation fails
    const firstChars = content.length > 500 ? content.substring(0, 500) : content;
    console.error(
      `[PlanAdapter] parsePureJson FAILED: error="${
        result.errors?.[0]?.message ?? "unknown"
      }", content_length=${content.length}, first_500_chars="${firstChars.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
    );

    // Map ValidationResult errors to PlanValidationError
    const message = result.errors?.[0]?.message || "Plan validation failed";
    const zodErrors = result.errors ? JSON.parse(JSON.stringify(result.errors)) as JSONValue : null;
    throw new PlanValidationError(message, {
      zodErrors,
      rawContent: content,
      repairAttempted: result.repairAttempted,
      repairSucceeded: result.repairSucceeded,
    });
  }

  /**
   * Substitutes real IPlanAction[] arrays for every TOML_BLOCK:N sentinel in envelope, then
   * validates against PlanSchema directly. Bypasses OutputValidator (and its this.metrics
   * tracking) since envelope is guaranteed free of embedded source code and needs no
   * repairJSON fallback — a deliberate, documented divergence from the pure-JSON path (Phase
   * 151 GAP-4): OutputValidator.getMetrics()/AgentRunner.getValidationMetrics() have zero
   * production consumers today, so this is currently inert.
   */
  private parseWithTomlActionBlocks(
    envelope: string,
    actionsByBlock: Map<number, IPlanAction[]>,
    rawContent: string,
  ): Plan {
    let parsedEnvelope: JSONValue;
    try {
      parsedEnvelope = JSON.parse(envelope);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Invalid JSON envelope";
      // Debug: log full raw content when envelope parse fails
      const firstChars = rawContent.length > 500 ? rawContent.substring(0, 500) : rawContent;
      console.error(
        `[PlanAdapter] parseWithTomlActionBlocks FAILED: error="${msg}", rawContent_length=${rawContent.length}, envelope_length=${envelope.length}, first_500_chars="${
          firstChars.replace(/"/g, '\\"').replace(/\n/g, "\\n")
        }"`,
      );
      throw new PlanValidationError(msg, {
        zodErrors: null,
        rawContent,
        repairAttempted: false,
        repairSucceeded: false,
      });
    }

    this.substituteTomlBlockSentinels(parsedEnvelope, actionsByBlock, rawContent);

    const result = PlanSchema.safeParse(parsedEnvelope);
    if (result.success) {
      return result.data;
    }

    throw new PlanValidationError(result.error.errors[0]?.message ?? "Plan validation failed", {
      zodErrors: JSON.parse(JSON.stringify(result.error.errors)) as JSONValue,
      rawContent,
      repairAttempted: false,
      repairSucceeded: false,
    });
  }

  /** Replaces every `actions: "TOML_BLOCK:N"` sentinel in-place with actionsByBlock.get(N). */
  private substituteTomlBlockSentinels(
    parsedEnvelope: JSONValue,
    actionsByBlock: Map<number, IPlanAction[]>,
    rawContent: string,
  ): void {
    if (parsedEnvelope === null || typeof parsedEnvelope !== "object" || Array.isArray(parsedEnvelope)) {
      return;
    }
    const steps = (parsedEnvelope as IEnvelopeWithSteps).steps;
    if (!Array.isArray(steps)) {
      return;
    }
    for (const step of steps) {
      if (step === null || typeof step !== "object") continue;
      const stepObj = step as IEnvelopeStep;
      // Accept both `actions: "TOML_BLOCK:N"` (bare string) and
      // `actions: ["TOML_BLOCK:N"]` (array wrapping) — the latter is a common
      // model output when the schema historically expected an array.
      const actionsStr = typeof stepObj.actions === "string"
        ? stepObj.actions
        : Array.isArray(stepObj.actions) && stepObj.actions.length === 1 && typeof stepObj.actions[0] === "string"
        ? stepObj.actions[0]
        : undefined;
      if (actionsStr === undefined) continue;
      const match = actionsStr.match(/^TOML_BLOCK:(\d+)$/);
      if (!match) continue;
      const markerNumber = Number(match[1]);
      const actions = actionsByBlock.get(markerNumber);
      if (!actions) {
        throw new PlanValidationError(
          `Plan references TOML_BLOCK:${markerNumber} but no matching fenced TOML block was found.`,
          { zodErrors: null, rawContent, repairAttempted: false, repairSucceeded: false },
        );
      }
      stepObj.actions = actions;
    }
  }

  /** Read-only passthrough to the internal OutputValidator's metrics — mirrors
   *  AgentRunner.getValidationMetrics()'s existing pattern for the same purpose. */
  getValidationMetrics(): IValidationMetrics {
    return this.validator.getMetrics();
  }

  /**
   * Get machine-readable instructions for the required response format.
   * @param useXml - When true, returns XML+Markdown format instructions (for providers
   *   without native JSON enforcement like opencode CLI). Defaults to false (JSON).
   */
  getSchemaInstructions(useXml: boolean = false): string {
    if (useXml) {
      return `
Your response in the <content> section MUST be an XML plan with <plan>, <description>, and <step> tags.
No JSON, no markdown code fences — only raw XML and Markdown text.

<plan>
  <title>Plan title (optional, 1-80 chars)</title>
  <description>Plan description (required)</description>
  <estimatedDuration>e.g. 2-3 hours (optional)</estimatedDuration>
  <step number="1">
    <title>Step title</title>
    <description>Step description (optional, defaults to title)</description>
    <tool>tool_name</tool>
    <params>
      <paramName>param value</paramName>
    </params>
    <successCriteria>
      <item>First criterion</item>
    </successCriteria>
  </step>
</plan>

For steps needing multiple tool calls, repeat <tool> and <params> pairs.
Do NOT write any prose preamble before or after the <plan> block.
The first character after <content> MUST be <.
`.trim();
    }

    const schemaDesc = describeSchema(PlanSchema);
    return `
Your response in the <content> section MUST be a valid JSON object matching this schema:
${schemaDesc}

Common Requirements:
- "title": string (1-80 chars, the plan name / summary describing the goal)
- "description": string
- "steps": array of objects (if this is an execution plan)
- analysis, security, qa, performance: objects (if this is an analysis report)

Ensure you use valid JSON syntax (no trailing commas, double quotes for keys).
Do NOT wrap the JSON in a markdown code fence (no \`\`\`json or \`\`\` lines) — the text between
<content> and </content> is parsed as JSON exactly as written; a fence line is not valid JSON
and will fail parsing even when the JSON itself is correct.
`.trim();
  }

  /**
   * Convert Plan object to markdown for human readability
   * (used for plan file storage and display)
   */
  toMarkdown(plan: Plan): string {
    const sections: string[] = [];

    // Add header section
    sections.push(...this.renderPlanHeader(plan));

    // Add execution steps
    sections.push(...this.renderExecutionSteps(plan));

    // Add specialized sections
    sections.push(...this.renderAnalysisSection(plan));
    sections.push(...this.renderSecuritySection(plan));
    sections.push(...this.renderQASection(plan));
    sections.push(...this.renderPerformanceSection(plan));

    return sections.join("\n");
  }

  /**
   * Render the plan header with title, description, duration, and risks
   */
  private renderPlanHeader(plan: Plan): string[] {
    // title and subject are both optional; never render the literal "# undefined". Fall back to
    // the legacy subject, then to a stable label so the markdown always has a valid H1.
    const headerName = plan.title ?? plan.subject ?? "Untitled Plan";
    const sections = [
      `# ${headerName}`,
      "",
      plan.description,
      "",
    ];

    if (plan.estimatedDuration) {
      sections.push(`**Estimated Duration:** ${plan.estimatedDuration}`, "");
    }

    if (plan.risks && plan.risks.length > 0) {
      sections.push("## Risks", "");
      plan.risks.forEach((risk) => sections.push(`- ${risk}`));
      sections.push("");
    }

    return sections;
  }

  /**
   * Render the execution steps section
   */
  private renderExecutionSteps(plan: Plan): string[] {
    const sections: string[] = [];

    sections.push("## Execution Steps", "");

    if (plan.steps) {
      plan.steps.forEach((step) => {
        sections.push(`## Step ${step.step}: ${step.title}`);
        sections.push("");
        sections.push(step.description);
        sections.push("");

        if (step.dependencies && step.dependencies.length > 0) {
          sections.push(`**Dependencies:** Steps ${step.dependencies.join(", ")}`);
          sections.push("");
        }

        if (step.tools && step.tools.length > 0) {
          sections.push(`**Tools:** ${step.tools.join(", ")}`);
          sections.push("");
        }

        if (step.successCriteria && step.successCriteria.length > 0) {
          sections.push("**Success Criteria:**");
          step.successCriteria.forEach((criteria) => sections.push(`- ${criteria}`));
          sections.push("");
        }

        if (step.actions && step.actions.length > 0) {
          sections.push(...this.renderStepActions(step.actions));
        }

        if (step.rollback) {
          sections.push(`**Rollback:** ${step.rollback}`);
          sections.push("");
        }
      });
    }

    return sections;
  }

  /**
   * Render actions for a single step
   */
  private renderStepActions(actions: NonNullable<Plan["steps"]>[0]["actions"]): string[] {
    const sections: string[] = [];

    actions!.forEach((action) => {
      sections.push("```toml");
      sections.push(`tool = "${action.tool}"`);
      if (action.description) {
        sections.push(`description = "${action.description}"`);
      }
      sections.push("[params]");
      for (const [key, value] of Object.entries(action.params)) {
        if (typeof value === "string") {
          if (value.includes("\n")) {
            sections.push(`${key} = '''\n${value}\n'''`);
          } else {
            sections.push(`${key} = "${value.replace(/"/g, '\\"')}"`);
          }
        } else {
          sections.push(`${key} = ${JSON.stringify(value)}`);
        }
      }
      sections.push("```");
      sections.push("");
    });

    return sections;
  }

  /**
   * Render the analysis section
   */
  private renderAnalysisSection(plan: Plan): string[] {
    if (!plan.analysis) return [];

    const sections: string[] = ["## Analysis Results", ""];
    const analysis = plan.analysis as NonNullable<Plan["analysis"]>;

    sections.push(...this.renderAnalysisBasics(analysis));
    sections.push(...this.renderAnalysisModules(analysis));
    sections.push(...this.renderAnalysisComponents(analysis));
    sections.push(...this.renderAnalysisPatterns(analysis));
    sections.push(...this.renderAnalysisMetrics(analysis));
    sections.push(...this.renderAnalysisRecommendations(analysis));

    return sections;
  }

  private renderAnalysisBasics(analysis: NonNullable<Plan["analysis"]>): string[] {
    const sections: string[] = [];
    if (analysis.totalFiles) sections.push(`**Total Files:** ${analysis.totalFiles}`);
    if (analysis.linesOfCode) sections.push(`**Lines of Code:** ${analysis.linesOfCode}`);
    if (analysis.mainLanguage) sections.push(`**Main Language:** ${analysis.mainLanguage}`);
    if (analysis.framework) sections.push(`**Framework:** ${analysis.framework}`);
    if (analysis.types) sections.push(`**Type Definitions:** ${analysis.types}`);
    sections.push("");
    return sections;
  }

  private renderAnalysisModules(analysis: NonNullable<Plan["analysis"]>): string[] {
    if (!analysis.modules || analysis.modules.length === 0) return [];
    const sections: string[] = ["### Modules", ""];
    analysis.modules.forEach((m) => {
      sections.push(`- **${m.name}**: ${m.purpose}`);
      if (m.exports.length > 0) sections.push(`  - *Exports:* ${m.exports.join(", ")}`);
      if (m.dependencies.length > 0) sections.push(`  - *Dependencies:* ${m.dependencies.join(", ")}`);
    });
    sections.push("");
    return sections;
  }

  private renderAnalysisComponents(analysis: NonNullable<Plan["analysis"]>): string[] {
    if (!analysis.components || analysis.components.length === 0) return [];
    const sections: string[] = ["### Key Components", ""];
    analysis.components.forEach((c) => {
      sections.push(`- **${c.name}** (${c.location}): ${c.purpose}`);
      if (c.api) sections.push(`  - *API:* ${c.api}`);
      if (c.dependencies && c.dependencies.length > 0) {
        sections.push(`  - *Dependencies:* ${c.dependencies.join(", ")}`);
      }
    });
    sections.push("");
    return sections;
  }

  private renderAnalysisPatterns(analysis: NonNullable<Plan["analysis"]>): string[] {
    if (!analysis.patterns || analysis.patterns.length === 0) return [];
    const sections: string[] = ["### Patterns Identified", ""];
    analysis.patterns.forEach((p) => {
      sections.push(`- **${p.pattern}** in \`${p.location}\`: ${p.usage}`);
    });
    sections.push("");
    return sections;
  }

  private renderAnalysisMetrics(analysis: NonNullable<Plan["analysis"]>): string[] {
    if (!analysis.metrics || analysis.metrics.length === 0) return [];
    const sections: string[] = ["### Metrics", ""];
    analysis.metrics.forEach((m) => {
      sections.push(`- **${m.metric}**: ${m.value} - *${m.assessment}*`);
    });
    sections.push("");
    return sections;
  }

  private renderAnalysisRecommendations(analysis: NonNullable<Plan["analysis"]>): string[] {
    if (!analysis.recommendations || analysis.recommendations.length === 0) return [];
    const sections: string[] = ["### Recommendations", ""];
    analysis.recommendations.forEach((r) => sections.push(`- ${r}`));
    sections.push("");
    return sections;
  }

  /**
   * Render the security analysis section
   */
  private renderSecuritySection(plan: Plan): string[] {
    const sections: string[] = [];

    if (!plan.security) return sections;

    sections.push("## Security Analysis", "");

    if (plan.security.executiveSummary) {
      sections.push("### Executive Summary", "", plan.security.executiveSummary, "");
    }

    if (plan.security.findings && plan.security.findings.length > 0) {
      sections.push("### Critical Findings", "");
      plan.security.findings.forEach((f) => {
        sections.push(`#### ${f.title} [${f.severity}]`);
        sections.push(`- **Location:** ${f.location}`);
        sections.push(`- **Impact:** ${f.impact}`);
        sections.push(`- **Remediation:** ${f.remediation}`);
        sections.push("");
        sections.push(f.description);
        sections.push("");
        if (f.codeExample) {
          sections.push("```typescript", f.codeExample, "```", "");
        }
      });
    }

    if (plan.security.recommendations && plan.security.recommendations.length > 0) {
      sections.push("### Security Recommendations", "");
      plan.security.recommendations.forEach((r) => sections.push(`- ${r}`));
      sections.push("");
    }

    if (plan.security.compliance && plan.security.compliance.length > 0) {
      sections.push("### Compliance Notes", "");
      plan.security.compliance.forEach((c) => sections.push(`- ${c}`));
      sections.push("");
    }

    return sections;
  }

  /**
   * Render the QA & testing section
   */
  private renderQASection(plan: Plan): string[] {
    const sections: string[] = [];

    if (!plan.qa) return sections;

    sections.push("## QA & Testing Results", "");

    if (plan.qa.testSummary && plan.qa.testSummary.length > 0) {
      sections.push("| Category | Planned | Executed | Passed | Failed |");
      sections.push("| --- | --- | --- | --- | --- |");
      plan.qa.testSummary.forEach((s) => {
        sections.push(`| ${s.category} | ${s.planned} | ${s.executed} | ${s.passed} | ${s.failed} |`);
      });
      sections.push("");
    }

    if (plan.qa.coverage) {
      const renderCoverage = (label: string, items?: Opt<(QACase | E2ECase)[], Reason.OptionalInput>) => {
        if (!items || items.length === 0) return;
        sections.push(`### ${label} Coverage`, "");
        items.forEach((entry) => {
          if ("journey" in entry) {
            sections.push(`#### ${entry.journey}: ${entry.scenario}`);
            sections.push(`- **Preconditions:** ${entry.preconditions}`);
            sections.push("**Steps:**");
            entry.steps.forEach((step: string) => sections.push(`- ${step}`));
            sections.push("**Verification Points:**");
            entry.verificationPoints.forEach((point: string) => sections.push(`- ${point}`));
            sections.push(`- **Status:** ${entry.status}`);
            sections.push("");
            return;
          }

          sections.push(`#### ${entry.scenario}`);
          sections.push(`- **Setup:** ${entry.setup}`);
          sections.push("**Steps:**");
          entry.steps.forEach((step: string) => sections.push(`- ${step}`));
          sections.push(`- **Expected Result:** ${entry.expectedResult}`);
          sections.push(`- **Status:** ${entry.status}`);
          if (entry.notes) {
            sections.push(`- **Notes:** ${entry.notes}`);
          }
          sections.push("");
        });
      };

      renderCoverage("Unit", plan.qa.coverage.unit);
      renderCoverage("Integration", plan.qa.coverage.integration);
      renderCoverage("E2E", plan.qa.coverage.e2e);
    }

    if (plan.qa.issues && plan.qa.issues.length > 0) {
      sections.push("### Issues Found", "");
      plan.qa.issues.forEach((i) => {
        sections.push(`#### ${i.title} [${i.severity}]`);
        sections.push(`- **Component:** ${i.component}`);
        if (i.description) sections.push(i.description, "");
        sections.push("**Steps to Reproduce:**");
        i.stepsToReproduce.forEach((s) => sections.push(`1. ${s}`));
        sections.push("");
      });
    }

    return sections;
  }

  /**
   * Render the performance analysis section
   */
  private renderPerformanceSection(plan: Plan): string[] {
    const sections: string[] = [];

    if (!plan.performance) return sections;

    sections.push("## Performance Analysis", "");

    if (plan.performance.executiveSummary) {
      sections.push("### Executive Summary", "", plan.performance.executiveSummary, "");
    }

    if (plan.performance.findings && plan.performance.findings.length > 0) {
      sections.push("### Performance Findings", "");
      plan.performance.findings.forEach((f) => {
        sections.push(`#### ${f.title} [Impact: ${f.impact}]`);
        sections.push(`- **Category:** ${f.category}`);
        sections.push(`- **Location:** ${f.location}`);
        sections.push(`- **Current Behavior:** ${f.currentBehavior}`);
        sections.push(`- **Expected Improvement:** ${f.expectedImprovement}`);
        sections.push(`- **Recommendation:** ${f.recommendation}`);
        sections.push("");
        if (f.codeExample) {
          sections.push("```typescript", f.codeExample, "```", "");
        }
      });
    }

    if (plan.performance.priorities && plan.performance.priorities.length > 0) {
      sections.push("### Optimization Priorities", "");
      plan.performance.priorities.forEach((p) => sections.push(`- ${p}`));
      sections.push("");
    }

    return sections;
  }
}
