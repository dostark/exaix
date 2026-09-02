/**
 * @module LearningExtractor
 * @path packages/memory/src/extraction/learning_extractor.ts
 * @description Analyzes execution memory to automatically extract potential patterns, decisions, and troubleshooting insights.
 * @architectural-layer Services
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "packages/schemas/src/memory_bank.ts"]
 */
import type { IExecutionMemory, IProposalLearning, IScratchpadEntry } from "@exaix/schemas/memory_bank.ts";
import { ExecutionStatus, LANG_TYPESCRIPT, MemoryReferenceType } from "@exaix/core";
import { ConfidenceAssessmentLevel, LearningCategory, MemoryBankSource, MemoryScope } from "@exaix/core";

/** Split out of MemoryExtractorService to keep that class's complexity in check. */
export class LearningExtractor {
  /**
   * Analyze an execution and extract potential learnings
   */
  static extract(execution: IExecutionMemory, scratchpadEntries: IScratchpadEntry[] = []): IProposalLearning[] {
    const learnings: IProposalLearning[] = [];

    // Skip trivial executions (no changes, no lessons, no scratchpad notes)
    if (scratchpadEntries.length === 0 && this.isTrivialExecution(execution)) {
      return learnings;
    }

    // Extract from lessons_learned field
    if (execution.lessons_learned && execution.lessons_learned.length > 0) {
      for (const lesson of execution.lessons_learned) {
        const learning = this.extractFromLesson(lesson, execution);
        if (learning) {
          learnings.push(learning);
        }
      }
    }

    // Extract from scratchpad entries (in-the-moment agent notes) with the same heuristics
    for (const entry of scratchpadEntries) {
      const learning = this.extractFromLesson(entry.content, execution);
      if (learning) {
        learnings.push(learning);
      }
    }

    // Extract patterns from successful executions
    if (execution.status === ExecutionStatus.COMPLETED) {
      const patternLearnings = this.extractPatternsFromSummary(execution);
      learnings.push(...patternLearnings);
    }

    // Extract troubleshooting from failed executions
    if (execution.status === ExecutionStatus.FAILED && execution.error_message) {
      const troubleshootingLearning = this.extractFromFailure(execution);
      if (troubleshootingLearning) {
        learnings.push(troubleshootingLearning);
      }
    }

    // Deduplicate by title
    const seen = new Set<string>();
    return learnings.filter((l) => {
      const key = l.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Check if execution is too trivial to extract learnings from
   */
  private static isTrivialExecution(execution: IExecutionMemory): boolean {
    // No changes made
    const changes = execution.changes;
    const hasChanges = (changes.files_created?.length || 0) +
        (changes.files_modified?.length || 0) +
        (changes.files_deleted?.length || 0) > 0;

    // No lessons learned
    const hasLessons = execution.lessons_learned && execution.lessons_learned.length > 0;

    // Short summary (less than 50 chars usually means trivial)
    const hasMeaningfulSummary = execution.summary.length > 50;

    // No error message for failed
    const hasError = execution.status === ExecutionStatus.FAILED && execution.error_message;

    return !hasChanges && !hasLessons && !hasMeaningfulSummary && !hasError;
  }

  /**
   * Extract a learning from a lessons_learned entry
   */
  private static extractFromLesson(lesson: string, execution: IExecutionMemory): IProposalLearning | null {
    // Skip very short lessons
    if (lesson.length < 10) return null;

    // Determine category from content
    const category = this.categorizeLesson(lesson);

    return {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      source: MemoryBankSource.EXECUTION,
      source_id: execution.trace_id,
      scope: MemoryScope.PROJECT,
      project: execution.portal,
      title: this.extractTitle(lesson),
      description: lesson,
      category,
      tags: this.extractTags(lesson, execution),
      confidence: ConfidenceAssessmentLevel.MEDIUM,
      references: [
        { type: MemoryReferenceType.EXECUTION, path: execution.trace_id },
      ],
    };
  }

  /**
   * Categorize a lesson based on its content
   */
  private static categorizeLesson(lesson: string): IProposalLearning["category"] {
    const lower = lesson.toLowerCase();

    if (lower.includes("avoid") || lower.includes("don't") || lower.includes("never")) {
      return LearningCategory.ANTI_PATTERN;
    }
    if (lower.includes("pattern") || lower.includes("approach") || lower.includes("structure")) {
      return LearningCategory.PATTERN;
    }
    if (lower.includes("decided") || lower.includes("choice") || lower.includes("chose")) {
      return LearningCategory.DECISION;
    }
    if (lower.includes(ERR_KEYWORD) || lower.includes("fix") || lower.includes("debug")) {
      return LearningCategory.TROUBLESHOOTING;
    }
    return LearningCategory.INSIGHT;
  }

  /**
   * Extract a short title from a lesson
   */
  private static extractTitle(text: string): string {
    // Take first sentence or first 100 chars
    const firstSentence = text.split(/[.!?]/)[0].trim();
    if (firstSentence.length <= 100) {
      return firstSentence;
    }
    return text.substring(0, 97) + "...";
  }

  /**
   * Extract relevant tags from content and execution context
   */
  private static extractTags(content: string, execution: IExecutionMemory): string[] {
    const tags: string[] = [];
    const lower = content.toLowerCase();

    // Language/framework tags
    if (lower.includes(LANG_TYPESCRIPT) || execution.context_files.some((f: string) => f.endsWith(".ts"))) {
      tags.push(LANG_TYPESCRIPT);
    }
    if (lower.includes("async") || lower.includes("await")) {
      tags.push("async");
    }
    if (lower.includes(ERR_KEYWORD) || lower.includes("exception")) {
      tags.push("error-handling");
    }
    if (lower.includes("test")) {
      tags.push("testing");
    }
    if (lower.includes("database") || lower.includes("sql")) {
      tags.push("database");
    }
    if (lower.includes("api") || lower.includes("rest") || lower.includes("http")) {
      tags.push("api");
    }

    return tags.slice(0, 5); // Max 5 tags
  }

  /**
   * Extract pattern learnings from execution summary
   */
  private static extractPatternsFromSummary(execution: IExecutionMemory): IProposalLearning[] {
    const learnings: IProposalLearning[] = [];
    const summary = execution.summary.toLowerCase();

    // Look for common pattern indicators
    const patternIndicators = [
      { keyword: "repository pattern", pattern: "Repository Pattern" },
      { keyword: "factory pattern", pattern: "Factory Pattern" },
      { keyword: "singleton", pattern: "Singleton Pattern" },
      { keyword: "dependency injection", pattern: "Dependency Injection" },
      { keyword: "error handling", pattern: "Error Handling Pattern" },
      { keyword: "validation", pattern: "Input Validation" },
    ];

    for (const indicator of patternIndicators) {
      if (summary.includes(indicator.keyword)) {
        learnings.push({
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          source: MemoryBankSource.EXECUTION,
          source_id: execution.trace_id,
          scope: MemoryScope.PROJECT,
          project: execution.portal,
          title: `${indicator.pattern} Implementation`,
          description: `Learned ${indicator.pattern.toLowerCase()} from execution: ${execution.summary}`,
          category: LearningCategory.PATTERN,
          tags: this.extractTags(execution.summary, execution),
          confidence: ConfidenceAssessmentLevel.MEDIUM,
          references: [
            { type: MemoryReferenceType.EXECUTION, path: execution.trace_id },
          ],
        });
      }
    }

    return learnings;
  }

  /**
   * Extract troubleshooting learning from failed execution
   */
  private static extractFromFailure(execution: IExecutionMemory): IProposalLearning | null {
    if (!execution.error_message) return null;

    // Create troubleshooting entry
    const title = this.extractTitle(`Troubleshooting: ${execution.error_message}`);

    return {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      source: MemoryBankSource.EXECUTION,
      source_id: execution.trace_id,
      scope: MemoryScope.PROJECT,
      project: execution.portal,
      title,
      description: `Error encountered: ${execution.error_message}\n\nContext: ${execution.summary}${
        execution.lessons_learned?.length ? "\n\nResolution: " + execution.lessons_learned.join("; ") : ""
      }`,
      category: LearningCategory.TROUBLESHOOTING,
      tags: ["error", ...this.extractTags(execution.error_message, execution)],
      confidence: ConfidenceAssessmentLevel.MEDIUM,
      references: [
        { type: MemoryReferenceType.EXECUTION, path: execution.trace_id },
      ],
    };
  }
}

const ERR_KEYWORD = "error";
