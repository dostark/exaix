/**
 * @module ContextCardGenerator
 * @path src/services/context/context_card_generator.ts
 * @description Generates and updates portal context cards in the memory bank, preserving user notes.
 * @architectural-layer Services
 * @related-files [src/services/memory_bank.ts, src/services/db.ts]
 */
import { DEFAULT_PROJECTS_MEMORY_PATH } from "@exaix/core";
import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import type { IDatabaseService } from "../core/db.ts";
import { ActivityActor } from "@exaix/core";
import type { Config } from "@exaix/schemas/config.ts";
import type { JSONValue } from "@exaix/core";

export interface IPortalInfo {
  alias: string;
  path: string;
  techStack: string[];
}

export class ContextCardGenerator {
  private config: Config;
  private db?: IDatabaseService;

  constructor(config: Config, db?: IDatabaseService) {
    this.config = config;
    this.db = db;
  }

  async generate(info: IPortalInfo): Promise<void> {
    const portalsDir = join(this.config.system.root, this.config.paths.memory, DEFAULT_PROJECTS_MEMORY_PATH);

    // Ensure directory exists
    await Deno.mkdir(portalsDir, { recursive: true });

    // Sanitize alias for filename
    // Replace spaces with underscores, remove non-alphanumeric chars (except _ and -)
    const safeAlias = info.alias.replace(/[^a-zA-Z0-9_-]/g, "_");
    const cardPath = join(portalsDir, `${safeAlias}`, "portal.md");

    let userNotes = "";
    let isUpdate = false;

    // Try to read existing file to preserve notes
    try {
      const existingContent = await Deno.readTextFile(cardPath);
      isUpdate = true;
      // Extract content after "## User Notes"
      const match = existingContent.match(/## User Notes\n([\s\S]*)/);
      if (match && match[1]) {
        userNotes = match[1].trim();
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      // If not found, userNotes remains empty
    }

    // Construct new content
    const content = [
      `# Portal: ${info.alias}`,
      `- **Path**: \`${info.path}\``,
      `- **Tech Stack**: ${info.techStack.join(", ")}`,
      ``,
      `## User Notes`,
      ``,
      userNotes || "Add your notes here...",
      ``,
    ].join("\n");

    // Ensure directory exists
    await ensureDir(dirname(cardPath));
    await Deno.writeTextFile(cardPath, content);

    // Log activity
    this.logActivity(isUpdate ? "context_card.updated" : "context_card.created", {
      alias: info.alias,
      file_path: cardPath,
      tech_stack: info.techStack,
    });
  }

  private logActivity(actionType: string, payload: Record<string, JSONValue>): void {
    if (!this.db) return;

    try {
      this.db.logActivity(
        ActivityActor.SYSTEM,
        actionType,
        payload.alias as string,
        payload,
        undefined, // No specific trace_id for context card operations
        null, // No identity_id (system operation)
      );
    } catch (error) {
      console.error("Failed to log activity:", error);
    }
  }
}
