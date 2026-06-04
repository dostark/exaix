/**
 * @module StatusManager
 * @path packages/request/src/processing/status.ts
 * @description Manages atomic updates to request file status and error tracking.
 * @architectural-layer Services
 * @related-files ["packages/request/src/processor.ts", "packages/core/src/status/request_status.ts"]
 */
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { RequestStatusType } from "@exaix/core/status";
import { RequestStatus } from "@exaix/core/status";

export class StatusManager {
  constructor(private readonly logger: IEventLogger) {}

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
      await this.logger.error(DomainEventType.RequestStatusUpdateFailed, filePath, {
        new_status: newStatus,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
