/**
 * @module IdaemonService
 * @path src/shared/interfaces/i_daemon_service.ts
 * @description Module for IdaemonService.
 * @architectural-layer Shared
 * * @related-files [src/shared/types/daemon.ts]
 */
import type { DaemonStatus } from "../enums.ts";

export interface IDaemonService {
  /**
   * Start the Exaix daemon.
   */
  start(): Promise<void>;

  /**
   * Stop the Exaix daemon.
   */
  stop(): Promise<void>;

  /**
   * Restart the Exaix daemon.
   */
  restart(): Promise<void>;

  /**
   * Get the current status of the daemon.
   */
  getStatus(): Promise<DaemonStatus>;

  /**
   * Get recent log entries from the daemon.
   */
  getLogs(): Promise<string[]>;

  /**
   * Get recent error entries from the daemon.
   */
  getErrors(): Promise<string[]>;
}
