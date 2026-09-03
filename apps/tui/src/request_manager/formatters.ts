/**
 * @module RequestFormatter
 * @path apps/tui/src/request_manager/formatters.ts
 * @description Formatting utilities for the Request Manager View, converting request metadata and content into stylized TUI panels.
 * @architectural-layer TUI
 * @related-files [apps/tui/src/request_manager_view.ts]
 */

import {
  TUI_DETAIL_DATE_LOCALE,
  TUI_LABEL_REQUEST_DETAILS,
  TUI_LAYOUT_MEDIUM_WIDTH,
  TUI_LAYOUT_VALUE_WIDTH,
  TUI_MSG_PRESS_QUIT,
} from "@exaix/tui/helpers/constants.ts";
import type { IRequest, Opt, Reason } from "@exaix/core/types";
import { type IRequestAnalysis, RequestAnalysisComplexity } from "@exaix/schemas/request_analysis.ts";

/**
 * Formatter for Request Manager View
 */
export class RequestFormatter {
  /**
   * Format request metadata section
   */
  static formatRequestMetadata(request: IRequest): string[] {
    return [
      `╔══════════════════════════════════════════════════════════════╗`,
      `║${
        TUI_LABEL_REQUEST_DETAILS.padStart(TUI_LAYOUT_MEDIUM_WIDTH / 2 + TUI_LABEL_REQUEST_DETAILS.length / 2).padEnd(
          TUI_LAYOUT_MEDIUM_WIDTH,
        )
      }║`,
      `╠══════════════════════════════════════════════════════════════╣`,
      `║ ID:       ${request.trace_id.padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`,
      `║ Subject:  ${(request.subject || "").padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`,
      `║ Status:   ${request.status.padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`,
      `║ Priority: ${request.priority.padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`,
      `║ Identity: ${request.agent_role.padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`,
      `║ Created:  ${new Date(request.created).toLocaleString(TUI_DETAIL_DATE_LOCALE).padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`,
      `║ Creator:  ${request.created_by.padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`,
      ...(request.rejected_path
        ? [
          `║ Rejected: ${request.rejected_path.padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`,
        ]
        : []),
      ...(request.error
        ? [
          `║ Error:    ${request.error.slice(0, TUI_LAYOUT_VALUE_WIDTH).padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`,
        ]
        : []),
    ];
  }

  /**
   * Format skills section if present
   */
  static formatSkillsSection(request: IRequest): string[] {
    if (!request.skills) return [];

    const lines: string[] = [
      `╠══════════════════════════════════════════════════════════════╣`,
      `║ Applied Skills:                                              ║`,
    ];

    const skills = request.skills;
    if (Array.isArray(skills)) {
      if (skills.length > 0) {
        const skillsStr = skills.join(", ");
        const limit = TUI_LAYOUT_MEDIUM_WIDTH - 12;
        lines.push(`║   Skills: ${skillsStr.slice(0, limit).padEnd(limit)} ║`);
      } else {
        lines.push(`║   (none)`.padEnd(TUI_LAYOUT_MEDIUM_WIDTH + 1) + `║`);
      }
    } else {
      if (skills.explicit && skills.explicit.length > 0) {
        const explicitStr = skills.explicit.join(", ");
        const limit = TUI_LAYOUT_MEDIUM_WIDTH - 14;
        lines.push(`║   Explicit: ${explicitStr.slice(0, limit).padEnd(limit)} ║`);
      }
      if (skills.autoMatched && skills.autoMatched.length > 0) {
        const autoStr = skills.autoMatched.join(", ");
        const limit = TUI_LAYOUT_MEDIUM_WIDTH - 18;
        lines.push(`║   Auto-matched: ${autoStr.slice(0, limit).padEnd(limit)} ║`);
      }
      if (skills.fromDefaults && skills.fromDefaults.length > 0) {
        const defStr = skills.fromDefaults.join(", ");
        const limit = TUI_LAYOUT_MEDIUM_WIDTH - 19;
        lines.push(`║   From defaults: ${defStr.slice(0, limit).padEnd(limit)} ║`);
      }
      if (skills.skipped && skills.skipped.length > 0) {
        const skipStr = skills.skipped.join(", ");
        const limit = TUI_LAYOUT_MEDIUM_WIDTH - 13;
        lines.push(`║   Skipped: ${skipStr.slice(0, limit).padEnd(limit)} ║`);
      }
      if (
        !skills.explicit?.length && !skills.autoMatched?.length &&
        !skills.fromDefaults?.length
      ) {
        lines.push(`║   (none)`.padEnd(TUI_LAYOUT_MEDIUM_WIDTH + 1) + `║`);
      }
    }

    return lines;
  }

  /**
   * Format analysis section
   */
  static formatAnalysisSection(analysis: IRequestAnalysis | null): string[] {
    if (!analysis) return [];

    const _complexityColors: Record<RequestAnalysisComplexity, string> = {
      [RequestAnalysisComplexity.SIMPLE]: "green",
      [RequestAnalysisComplexity.MEDIUM]: "yellow",
      [RequestAnalysisComplexity.COMPLEX]: "red",
      [RequestAnalysisComplexity.EPIC]: "magenta",
    };

    const lines: string[] = [
      `╠═════════[ REQUEST ANALYSIS ]══════════════════════════════════╣`,
    ];

    // Complexity and actionability
    const comp = analysis.complexity || "unknown";
    const score = analysis.actionabilityScore || 0;
    const barWidth = 10;
    const filled = Math.round((score / 100) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

    lines.push(`║ Complexity:   ${comp.padEnd(TUI_LAYOUT_VALUE_WIDTH)}║`);
    lines.push(`║ Actionability: ${bar} ${score}/100`.padEnd(TUI_LAYOUT_MEDIUM_WIDTH + 1) + `║`);

    // Goals summary
    if (analysis.goals && analysis.goals.length > 0) {
      lines.push(`║ Goals:        ${analysis.goals.length} total`.padEnd(TUI_LAYOUT_MEDIUM_WIDTH + 1) + `║`);
      for (const goal of analysis.goals.slice(0, 3)) {
        const marker = goal.explicit ? "[E]" : "[I]";
        const text = goal.description.slice(0, TUI_LAYOUT_MEDIUM_WIDTH - 15);
        lines.push(`║   ${marker} ${text.padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 12)} ║`);
      }
    }

    // Requirements/Ambiguities
    const reqCount = analysis.requirements?.length || 0;
    const ambCount = analysis.ambiguities?.length || 0;
    lines.push(`║ Requirements: ${reqCount} | Ambiguities: ${ambCount}`.padEnd(TUI_LAYOUT_MEDIUM_WIDTH + 1) + `║`);

    if (ambCount > 0 && analysis.ambiguities) {
      const topAmb = analysis.ambiguities[0];
      const ambText = (typeof topAmb === "string" ? topAmb : topAmb.description).slice(
        0,
        TUI_LAYOUT_MEDIUM_WIDTH - 15,
      );
      lines.push(`║   Top Ambiguity: ${ambText.padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 18)} ║`);
    }

    // Referenced files
    if (analysis.referencedFiles && analysis.referencedFiles.length > 0) {
      const filesStr = analysis.referencedFiles.join(", ").slice(0, TUI_LAYOUT_MEDIUM_WIDTH - 15);
      lines.push(`║ Files:        ${filesStr.padEnd(TUI_LAYOUT_MEDIUM_WIDTH - 14)} ║`);
    }

    return lines;
  }

  /**
   * Format content section
   */
  static formatContentSection(content: string): string[] {
    const lines: string[] = [
      `╠══════════════════════════════════════════════════════════════╣`,
      `║ Content:                                                     ║`,
      `╠══════════════════════════════════════════════════════════════╣`,
    ];

    const contentLines = content.split("\n");
    for (const line of contentLines) {
      lines.push(`║ ${line.slice(0, TUI_LAYOUT_MEDIUM_WIDTH).padEnd(TUI_LAYOUT_MEDIUM_WIDTH)}║`);
    }

    return lines;
  }

  /**
   * Format complete request detail content
   */
  static formatDetailContent(
    request: Opt<IRequest, Reason.OptionalContext>,
    content: string,
    analysis: IRequestAnalysis | null = null,
  ): string {
    if (!request) return content;

    const lines: string[] = [
      ...this.formatRequestMetadata(request),
      ...this.formatSkillsSection(request),
    ];

    // Analysis section
    if (analysis) {
      lines.push(...this.formatAnalysisSection(analysis));
    }

    lines.push(
      ...this.formatContentSection(content),
      `╚══════════════════════════════════════════════════════════════╝`,
      "",
      TUI_MSG_PRESS_QUIT,
    );

    return lines.join("\n");
  }
}
