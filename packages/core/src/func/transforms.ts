/**
 * @module FlowTransforms
 * @path packages/core/src/func/transforms.ts
 * @description Transform functions for flow execution pipeline — pure string/JSON utilities.
 */

import type { JSONValue } from "@exaix/core";

export function passthrough(input: string): string {
  return input;
}

function normalizeMarkdownHeaders(input: string): string {
  return input.replace(/^(#{1,6} .+)\n([^\n#])/gm, "$1\n\n$2");
}

export function mergeAsContext(inputs: string[]): string {
  if (inputs.length === 0) return "";

  let prefix = "";
  const updatedInputs = [...inputs];
  const firstInput = updatedInputs[0];
  const headerMatch = firstInput.match(/^(#\s.+?)\n/);

  if (headerMatch) {
    prefix = `${headerMatch[1]}\n\n`;
    updatedInputs[0] = firstInput.slice(headerMatch[0].length);
  }

  const hasHeaderInput = updatedInputs.some((input) => /^#{1,6}\s/.test(input.trimStart()));

  const merged = updatedInputs
    .map((input, index) => {
      const normalizedInput = normalizeMarkdownHeaders(input);
      const startsWithHeader = /^#{1,6}\s/.test(normalizedInput.trimStart());
      const stepHeader = `## Step ${index + 1}\n${index === 0 && prefix ? "\n" : startsWithHeader ? "\n" : ""}`;
      return `${stepHeader}${normalizedInput}`;
    })
    .join("\n\n");

  const output = `${prefix}${merged}`;
  return hasHeaderInput && !output.endsWith("\n") ? `${output}\n` : output;
}

export function extractSection(input: string, sectionName: string): string {
  const lines = input.split("\n");
  let inSection = false;
  const sectionContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ") && line.includes(sectionName)) {
      inSection = true;
      continue;
    }

    if (inSection && line.startsWith("## ")) {
      break;
    }

    if (inSection) {
      sectionContent.push(line);
    }
  }

  if (!inSection) {
    throw new Error(`Section '${sectionName}' not found`);
  }

  while (sectionContent.length > 0 && sectionContent[0].trim() === "") {
    sectionContent.shift();
  }
  while (sectionContent.length > 0 && sectionContent[sectionContent.length - 1].trim() === "") {
    sectionContent.pop();
  }

  return sectionContent.join("\n");
}

export function appendToRequest(request: string, stepOutput: string): string {
  const requestPart = request ? `Original: ${request}` : "Original:";
  const outputPart = stepOutput ? `Step Output: ${stepOutput}` : "Step Output:";
  return `${requestPart}\n\n${outputPart}`;
}

export function templateFill(template: string, context: Record<string, JSONValue>): string {
  let result = template;

  const variablePattern = /\{\{(\w+)\}\}/g;
  const variables: string[] = [];
  let match;

  while ((match = variablePattern.exec(template)) !== null) {
    const variable = match[1];
    if (!variables.includes(variable)) {
      variables.push(variable);
    }
  }

  for (const variable of variables) {
    if (!(variable in context)) {
      throw new Error(`Missing context variable: ${variable}`);
    }
    const placeholder = `{{${variable}}}`;
    const rawValue = context[variable];
    const value = typeof rawValue === "object" ? JSON.stringify(rawValue) : String(rawValue);
    result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), value);
  }

  return result;
}
