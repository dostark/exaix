/**
 * @module StatusManager
 * @path src/services/request_processing/status_manager.ts
 * @description Manages atomic updates to request file status and error tracking.
 * @architectural-layer Services
 * * @related-files [src/services/request_processor.ts, src/requests/request_status.ts]
 */
import type { EventLogger } from "../core/event_logger.ts";
import type { RequestStatusType } from "@exaix/core/status/request_status.ts";
import { RequestStatus } from "@exaix/core/status/request_status.ts";

export class StatusManager {
  constructor(private readonly logger: EventLogger) {}

  /**
   * Update the status field in a request file's YAML frontmatter
   */
  async updateStatus(
    filePath: string,
    newStatus: RequestStatusType,
    errorMessage?: string,
    extraFields?: Record<string, string>,
  ): Promise<void> {
    try {
      const originalContent = await Deno.readTextFile(filePath);
      let updatedContent = originalContent.replace(
        /^(status:\s*).+$/m,
        `$1${newStatus}`,
      );

      // If status is FAILED and we have an error message, add/update error field
      if (newStatus === RequestStatus.FAILED && errorMessage) {
        // Check if error field already exists
        if (updatedContent.match(/^error:\s*.+$/m)) {
          // Update existing error field
          updatedContent = updatedContent.replace(
            /^(error:\s*).+$/m,
            `$1"${errorMessage.replace(/"/g, '\\"')}"`,
          );
        } else {
          // Add error field after status field
          updatedContent = updatedContent.replace(
            /^(status:\s*.+)$/m,
            `$1\nerror: "${errorMessage.replace(/"/g, '\\"')}"`,
          );
        }
      }

      // If there are extra fields to persist (e.g. rejected_path, subject), add/update them
      if (extraFields && Object.keys(extraFields).length > 0) {
        for (const [key, val] of Object.entries(extraFields)) {
          const safeVal = String(val).replace(/"/g, '\\"');
          const fieldRegex = new RegExp(`^${key}:\\s*.+$`, "m");
          if (updatedContent.match(fieldRegex)) {
            updatedContent = updatedContent.replace(
              new RegExp(`^(${key}:\\s*).+$`, "m"),
              `$1"${safeVal}"`,
            );
          } else {
            updatedContent = updatedContent.replace(
              /^(status:\s*.+)$/m,
              `$1\n${key}: "${safeVal}"`,
            );
          }
        }
      }

      await Deno.writeTextFile(filePath, updatedContent);
    } catch (error) {
      await this.logger.error("request.status_update_failed", filePath, {
        new_status: newStatus,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
