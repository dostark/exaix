/**
 * @module ValidationChain
 * @path src/cli/validation/validation_chain.ts
 * @description Provides a chainable validation utility for CLI command arguments, allowing multiple rules and error aggregation.
 * @architectural-layer CLI
 * * @related-files [src/cli/handlers/request_create_handler.ts]
 */

import type { ValidationResult } from "../base/command.ts";
import type { JSONObject } from "../../shared/types/json.ts";
import type { JSONValue } from "@exaix/core";

export type ValidationRule = (value: JSONValue) => string | null;

/**
 * Chain of validation rules to be applied sequentially.
 */
export class ValidationChain {
  private rules: Map<string, ValidationRule[]> = new Map();

  /**
   * Add a validation rule for a specific field.
   * @param field The field name to validate
   * @param rule The validation function (returns error string or null)
   */
  addRule(field: string, rule: ValidationRule): this {
    if (!this.rules.has(field)) {
      this.rules.set(field, []);
    }
    this.rules.get(field)!.push(rule);
    return this;
  }

  /**
   * Validate an object against the configured rules.
   * @param data The object to validate
   */
  validate(data: JSONObject): ValidationResult {
    const errors: string[] = [];

    for (const [field, rules] of this.rules.entries()) {
      const value = data[field];
      for (const rule of rules) {
        const error = rule(value);
        if (error) {
          errors.push(`${field}: ${error}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // --- Common Rules ---

  static required(): ValidationRule {
    return (value) => (value === undefined || value === null || value === "") ? "is required" : null;
  }

  static isString(): ValidationRule {
    return (value) => (typeof value !== "string") ? "must be a string" : null;
  }

  static uuid(): ValidationRule {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return (value) => (typeof value === "string" && !uuidRegex.test(value)) ? "must be a valid UUID" : null;
  }
}
