/**
 * @module KnowledgeDocsHelpers
 * @path tests/docs/helpers.ts
 * @description Provides common utilities for documentation verification,
 * including Markdown section parsing and link validation.
 */

/**
 * Read the User Guide document
 */
export async function readUserGuide(): Promise<string> {
  return await Deno.readTextFile("docs/Exaix_User_Guide.md");
}

/**
 * Read the Model Settings document
 */
export async function readModelSettings(): Promise<string> {
  return await Deno.readTextFile("docs/Model_Settings.md");
}

/**
 * Check if a template file exists
 */
export async function templateExists(filename: string): Promise<boolean> {
  try {
    await Deno.stat(`templates/${filename}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read any documentation file from docs/
 */
export async function readDoc(filename: string): Promise<string> {
  return await Deno.readTextFile(`docs/${filename}`);
}
