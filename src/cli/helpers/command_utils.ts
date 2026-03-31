/**
 * @module CommandUtils
 * @path src/cli/helpers/command_utils.ts
 * @description Shared helper functions for CLI commands, including validation error formatting and UI prompts.
 * @architectural-layer CLI
 * * @related-files [src/cli/base/command.ts]
 */

import { ValidationResult } from "../base/command.ts";
import type { JSONObject } from "../../shared/types/json.ts";

export const CommandUtils = {
  /**
   * Format validation errors into a single string
   */
  formatValidationErrors(result: ValidationResult): string {
    if (result.isValid) return "";

    const mapError = (err: string) => {
      const parts = err.split(":");
      if (parts.length === 1) return err;

      const key = parts[0].trim();
      const rest = parts.slice(1).join(":").trim();

      // Common niceties for human-friendly messages used by tests
      if (rest === "is required") {
        if (key === "reason") return "Rejection reason is required";
        return `${key.charAt(0).toUpperCase() + key.slice(1)} is required`;
      }

      if (/^at least/i.test(rest)) {
        // Drop the key and capitalize the message: "At least one comment is required"
        return rest.charAt(0).toUpperCase() + rest.slice(1);
      }

      // Default: try to produce "Field message" or fall back to raw
      if (/^(cannot|is|must|should|at least)/i.test(rest)) {
        return `${key.charAt(0).toUpperCase() + key.slice(1)} ${rest}`;
      }

      return `${key.charAt(0).toUpperCase() + key.slice(1)}: ${rest}`;
    };

    const formatted = result.errors.map(mapError).join("\n- ");
    return `Validation failed:\n- ${formatted}`;
  },

  /**
   * Simple confirmation prompt
   */
  async confirm(message: string): Promise<boolean> {
    console.log(`${message} (y/N)`);
    const buffer = new Uint8Array(1);
    await Deno.stdin.read(buffer);
    const char = new TextDecoder().decode(buffer).trim().toLowerCase();
    return char === "y";
  },

  /**
   * Print a table-like structure for metadata
   */
  printMetadata(title: string, data: JSONObject): void {
    console.log(`\n${title}`);
    console.log("=".repeat(title.length));
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        console.log(`${key.padEnd(20)}: ${value}`);
      }
    }
    console.log("");
  },
};
