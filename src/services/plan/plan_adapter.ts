/**
 * @module PlanAdapter
 * @path src/services/plan/plan_adapter.ts
 * @description JSON validation and markdown conversion for LLM plans.
 *
 * Responsibilities:
 * 1. Parse and validate JSON plan output from LLMs
 * 2. Convert validated Plan objects to readable markdown
 * 3. Provide structured error reporting for validation failures
 *
 * @architectural-layer Services
 * * @related-files [src/services/plan_writer.ts, src/services/tool/output_validator.ts]
 */

import { type Plan, PlanSchema } from "@exaix/schemas/plan_schema.ts";
import { createOutputValidator, type OutputValidator } from "../tool/output_validator.ts";
import { describeSchema } from "@exaix/schemas/schema_describer.ts";
import { type JSONValue, toSafeJson } from "../../shared/types/json.ts";

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
    const result = this.validator.validate(content, PlanSchema);

    if (result.success && result.value) {
      return result.value;
    }

    // Map ValidationResult errors to PlanValidationError
    const message = result.errors?.[0]?.message || "Plan validation failed";
    throw new PlanValidationError(message, {
      zodErrors: result.errors ? toSafeJson(result.errors) : null,
      rawContent: content,
      repairAttempted: result.repairAttempted,
      repairSucceeded: result.repairSucceeded,
    });
  }

  /**
   * Get machine-readable instructions for the required JSON schema
   */
  getSchemaInstructions(): string {
    const schemaDesc = describeSchema(PlanSchema);
    return `
Your response in the <content> section MUST be a valid JSON object matching this schema:
${schemaDesc}

Common Requirements:
- "subject": string (1-80 chars, summary describing the goal)
- "description": string
- "steps": array of objects (if this is an execution plan)
- analysis, security, qa, performance: objects (if this is an analysis report)

Ensure you use valid JSON syntax (no trailing commas, double quotes for keys).
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
    const sections = [
      `# ${plan.subject}`,
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
      const renderCoverage = (label: string, items?: (QACase | E2ECase)[]) => {
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
