/**
 * @module CoreContextCardGenerator
 * @path packages/core/src/context/context_card_generator.ts
 * @description Generates and updates portal context cards in the memory bank, preserving user notes.
 * @architectural-layer Services
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "packages/core/src/types/i_database_service.ts"]
 */
import * as pathBuilders from "@exaix/shared";
import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import type { Config } from "@exaix/schemas/config.ts";
import type { IEventLogger } from "@exaix/core/logger";
import type { Opt, Reason } from "@exaix/core/types";

export interface IPortalInfo {
  alias: string;
  path: string;
  techStack: string[];
}

export class ContextCardGenerator {
  private config: Config;
  private logger?: Opt<IEventLogger, Reason.OptionalDependency>;

  constructor(config: Config, logger?: Opt<IEventLogger, Reason.OptionalDependency>) {
    this.config = config;
    this.logger = logger;
  }

  async generate(info: IPortalInfo): Promise<void> {
    const portalsDir = pathBuilders.memoryProjectsPath(join(this.config.system.root, this.config.paths.memory));

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
    this.logger?.info(
      isUpdate ? "context_card.updated" : "context_card.created",
      info.alias,
      {
        alias: info.alias,
        file_path: cardPath,
        tech_stack: info.techStack,
      },
    );
  }
}
