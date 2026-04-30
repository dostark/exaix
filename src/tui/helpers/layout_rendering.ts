/**
 * @module LayoutRendering
 * @path src/tui/helpers/layout_rendering.ts
 * @description Shared layout rendering utilities for TUI preset lists and indicators.
 * @architectural-layer Helpers
 * @related-files ["src/tui/helpers/layout_manager.ts"]
 */
import { colorize, type ITuiTheme } from "./colors.ts";

export interface ILayoutPresetDisplay {
  name: string;
  description: string;
  icon: string;
  shortcut: string;
}

export function renderLayoutPresetListLines(
  presets: ILayoutPresetDisplay[],
  selectedIndex: number | null,
  theme: ITuiTheme,
  options: { width: number; includeSuffix?: boolean; showDescription?: boolean },
): string[] {
  const lines: string[] = [];
  const includeSuffix = options.includeSuffix ?? false;
  const showDescription = options.showDescription ?? true;

  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];
    const isSelected = selectedIndex !== null && i === selectedIndex;
    const prefix = isSelected ? "▶ " : "  ";
    const suffix = includeSuffix ? (isSelected ? " ◀" : "  ") : "";
    const shortcut = preset.shortcut ? `${preset.shortcut}. ` : "";

    let line = `${prefix}${shortcut}${preset.icon} ${preset.name}${suffix}`;
    line = line.padEnd(options.width);

    if (isSelected) {
      line = colorize(line, theme.primary, theme.reset);
    }

    lines.push(
      colorize("│", theme.border, theme.reset) + " " + line + " " +
        colorize("│", theme.border, theme.reset),
    );

    if (isSelected && showDescription) {
      const desc = `   ${preset.description}`.padEnd(options.width);
      lines.push(
        colorize("│", theme.border, theme.reset) + " " +
          colorize(desc, theme.textDim, theme.reset) + " " +
          colorize("│", theme.border, theme.reset),
      );
    }
  }

  return lines;
}
