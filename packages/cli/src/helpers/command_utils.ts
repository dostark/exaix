/**
 * @module CommandUtils
 * @path packages/cli/src/helpers/command_utils.ts
 * @related-files []
 * @description Shared helper functions for CLI commands, including validation error formatting and UI prompts.
 * @architectural-layer CLI
 * @ungrounded
 */

import type { IValidationResult } from "../base/command.ts";
import type { JSONObject } from "@exaix/core/types";

export const CommandUtils = {
  formatValidationErrors(result: IValidationResult): string {
    if (result.isValid) return "";

    const mapError = (err: string) => {
      const parts = err.split(":");
      if (parts.length === 1) return err;

      const key = parts[0].trim();
      const rest = parts.slice(1).join(":").trim();

      if (rest === "is required") {
        if (key === "reason") return "Rejection reason is required";
        return `${key.charAt(0).toUpperCase() + key.slice(1)} is required`;
      }

      if (/^at least/i.test(rest)) {
        return rest.charAt(0).toUpperCase() + rest.slice(1);
      }

      if (/^(cannot|is|must|should|at least)/i.test(rest)) {
        return `${key.charAt(0).toUpperCase() + key.slice(1)} ${rest}`;
      }

      return `${key.charAt(0).toUpperCase() + key.slice(1)}: ${rest}`;
    };

    const formatted = result.errors.map(mapError).join("\n- ");
    return `Validation failed:\n- ${formatted}`;
  },

  async confirm(message: string): Promise<boolean> {
    console.log(`${message} (y/N)`);
    const buffer = new Uint8Array(1);
    await Deno.stdin.read(buffer);
    const char = new TextDecoder().decode(buffer).trim().toLowerCase();
    return char === "y";
  },

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
