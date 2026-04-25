/**
 * @module MarkdownRenderer
 * @path src/tui/helpers/markdown_renderer.ts
 * @description TUI Markdown renderer for ANSI-styled terminal output with support for headers, code blocks, and badges.
 * @architectural-layer Helpers
 * * @related-files [src/enums.ts, src/helpers/constants.ts]
 */

import { ConfidenceLevel } from "@exaix/core";
import { TUI_LAYOUT_FULL_WIDTH } from "./constants.ts";
import { ANSI } from "./colors.ts";

// ===== Interfaces =====

export interface IRenderOptions {
  useColors: boolean;
  maxWidth?: number;
}

// ===== ANSI Styles =====

export const MarkdownStyles = {
  h1: `${ANSI.bold}${ANSI.cyan}`, // Bold Cyan
  h2: `${ANSI.bold}${ANSI.blue}`, // Bold Blue
  h3: `${ANSI.bold}${ANSI.magenta}`, // Bold Magenta
  bold: ANSI.bold,
  italic: ANSI.italic,
  code: ANSI.yellow,
  codeBlock: `${ANSI.dim}${ANSI.yellow}`,
  link: `${ANSI.underline}${ANSI.blue}`,
  listMarker: ANSI.cyan,
  dim: ANSI.dim,
  reset: ANSI.reset,
};

/**
 * Render markdown text to ANSI-styled output
 */
export function renderMarkdown(text: string, options: IRenderOptions): string {
  const { useColors, maxWidth = TUI_LAYOUT_FULL_WIDTH } = options;
  const s = useColors ? MarkdownStyles : emptyStyles();

  const lines = text.split("\n");
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";

  for (const line of lines) {
    // Code block start/end
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        output.push(
          `${s.codeBlock}┌─ ${codeBlockLang || "code"} ${
            "─".repeat(Math.max(0, maxWidth - codeBlockLang.length - 6))
          }${s.reset}`,
        );
      } else {
        inCodeBlock = false;
        output.push(`${s.codeBlock}└${"─".repeat(maxWidth - 2)}${s.reset}`);
        codeBlockLang = "";
      }
      continue;
    }

    // Inside code block
    if (inCodeBlock) {
      output.push(`${s.codeBlock}│ ${line}${s.reset}`);
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      output.push(`${s.h3}${line.slice(4)}${s.reset}`);
      continue;
    }
    if (line.startsWith("## ")) {
      output.push(`${s.h2}${line.slice(3)}${s.reset}`);
      continue;
    }
    if (line.startsWith("# ")) {
      output.push(`${s.h1}${line.slice(2)}${s.reset}`);
      continue;
    }

    // List items
    if (line.match(/^[-*]\s/)) {
      const content = renderInlineStyles(line.slice(2), s);
      output.push(`${s.listMarker}•${s.reset} ${content}`);
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      if (match) {
        const content = renderInlineStyles(match[2], s);
        output.push(`${s.listMarker}${match[1]}.${s.reset} ${content}`);
      }
      continue;
    }

    // Regular line with inline styles
    output.push(renderInlineStyles(line, s));
  }

  // Close unclosed code block
  if (inCodeBlock) {
    output.push(`${s.codeBlock}└${"─".repeat(maxWidth - 2)}${s.reset}`);
  }

  return output.join("\n");
}

/**
 * Render inline markdown styles (bold, italic, code, links)
 */
function renderInlineStyles(text: string, s: typeof MarkdownStyles): string {
  let result = text;

  // Inline code: `code`
  result = result.replace(/`([^`]+)`/g, `${s.code}$1${s.reset}`);

  // Bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, `${s.bold}$1${s.reset}`);
  result = result.replace(/__([^_]+)__/g, `${s.bold}$1${s.reset}`);

  // Italic: *text* or _text_
  result = result.replace(/\*([^*]+)\*/g, `${s.italic}$1${s.reset}`);
  result = result.replace(/_([^_]+)_/g, `${s.italic}$1${s.reset}`);

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, `${s.link}$1${s.reset}`);

  return result;
}

/**
 * Create empty styles for no-color mode
 */
function emptyStyles(): typeof MarkdownStyles {
  const empty = {} as Record<keyof typeof MarkdownStyles, string>;
  for (const key of Object.keys(MarkdownStyles) as (keyof typeof MarkdownStyles)[]) {
    empty[key] = "";
  }
  return empty as typeof MarkdownStyles;
}

/**
 * Strip all markdown formatting from text
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,3}\s+/gm, "") // Headers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // Bold
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1") // Italic
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1") // Inline code
    .replace(/```[\s\S]*?```/g, "") // Code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // Links
}

/**
 * Wrap text to specified width
 */
export function wrapText(text: string, width: number): string {
  const lines: string[] = [];
  const words = text.split(/\s+/);
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines.join("\n");
}

/**
 * Render a loading spinner frame
 */
export function renderSpinner(frame: number): string {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  return frames[frame % frames.length];
}

/**
 * Render a progress bar
 */
export function renderProgressBar(
  current: number,
  total: number,
  width: number = 20,
  useColors: boolean = true,
): string {
  const percent = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(width * percent);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const percentStr = `${Math.round(percent * 100)}%`;

  if (useColors) {
    return `\x1b[32m${bar}\x1b[0m ${percentStr}`;
  }
  return `${bar} ${percentStr}`;
}

/**
 * Render confidence level with styling
 */
export function renderConfidence(
  confidence: ConfidenceLevel,
  useColors: boolean = true,
): string {
  const styles = useColors ? MarkdownStyles : emptyStyles();
  const icons: Record<string, string> = {
    [ConfidenceLevel.HIGH]: "●●●",
    [ConfidenceLevel.MEDIUM]: "●●○",
    [ConfidenceLevel.LOW]: "●○○",
  };
  const colors: Record<string, string> = {
    [ConfidenceLevel.HIGH]: ANSI.green,
    [ConfidenceLevel.MEDIUM]: ANSI.yellow,
    [ConfidenceLevel.LOW]: ANSI.red,
  };

  const icon = icons[confidence] || "○○○";
  if (useColors) {
    return `${colors[confidence]}${icon}${styles.reset} ${confidence}`;
  }
  return `${icon} ${confidence}`;
}

/**
 * Render category badge with color
 */
export function renderCategoryBadge(
  category: string,
  useColors: boolean = true,
): string {
  const colors: Record<string, string> = {
    pattern: ANSI.cyan,
    "anti-pattern": ANSI.red,
    decision: ANSI.magenta,
    insight: ANSI.blue,
    troubleshooting: ANSI.yellow,
  };

  const color = colors[category] || ANSI.white; // Default white
  if (useColors) {
    return `${color}[${category}]${ANSI.reset}`;
  }
  return `[${category}]`;
}
