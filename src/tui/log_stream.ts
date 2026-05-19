/**
 * @module LogStream
 * @path src/tui/log_stream.ts
 * @description Manager for real-time log streaming to the TUI, featuring buffering, filtering, and connection management.
 * @architectural-layer TUI
 * @related-files [src/tui/structured_log_viewer.ts]
 */

import type { IStructuredLogEntry } from "@exaix/core/types";
import type { StructuredLoggerService } from "./structured_log_service.ts";
import type { JSONObject } from "@exaix/core/types";
import { DEFAULT_AI_TIMEOUT_MS } from "@exaix/ai/constants.ts";
import { ConnectionStatus } from "@exaix/core";

/**
 * Log stream configuration
 */
export interface ILogStreamConfig {
  /** Maximum buffer size */
  maxBufferSize: number;
  /** Stream update interval in milliseconds */
  updateInterval: number;
  /** Whether to enable streaming */
  enabled: boolean;
  /** Auto-cleanup interval for old entries */
  cleanupInterval: number;
  /** Maximum age of entries to keep (milliseconds) */
  maxEntryAge: number;
}

/**
 * Log stream state
 */
export interface LogStreamState {
  /** Whether streaming is active */
  isActive: boolean;
  /** Current buffer size */
  bufferSize: number;
  /** Number of subscribers */
  subscriberCount: number;
  /** Last update timestamp */
  lastUpdate: Date | null;
  /** Connection status */
  status: ConnectionStatus;
}

/**
 * Real-time log streaming manager
 */
export class LogStreamManager {
  private buffer: IStructuredLogEntry[] = [];
  private subscribers: Array<(entries: IStructuredLogEntry[]) => void> = [];
  private updateTimer?: number;
  private cleanupTimer?: number;
  private state: LogStreamState;

  constructor(
    private service: StructuredLoggerService,
    private config: ILogStreamConfig,
  ) {
    this.state = {
      isActive: false,
      bufferSize: 0,
      subscriberCount: 0,
      lastUpdate: null,
      status: ConnectionStatus.DISCONNECTED,
    };
  }

  /**
   * Start the log stream
   */
  start(): void {
    if (this.state.isActive) return;

    this.state.isActive = true;
    this.state.status = ConnectionStatus.CONNECTING;

    // Subscribe to the log service
    this.service.subscribeToLogs((entry) => {
      this.handleNewEntry(entry);
    });

    // Start periodic updates
    this.updateTimer = setInterval(() => {
      this.flushBuffer();
    }, this.config.updateInterval);

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldEntries();
    }, this.config.cleanupInterval);

    this.state.status = ConnectionStatus.CONNECTED;
  }

  /**
   * Stop the log stream
   */
  stop(): void {
    if (!this.state.isActive) return;

    this.state.isActive = false;
    this.state.status = ConnectionStatus.DISCONNECTED;

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Clear subscribers
    this.subscribers = [];
  }

  /**
   * Subscribe to log stream updates
   */
  subscribe(callback: (entries: IStructuredLogEntry[]) => void): () => void {
    this.subscribers.push(callback);
    this.state.subscriberCount = this.subscribers.length;

    // Return unsubscribe function
    return () => {
      const index = this.subscribers.indexOf(callback);
      if (index > -1) {
        this.subscribers.splice(index, 1);
        this.state.subscriberCount = this.subscribers.length;
      }
    };
  }

  /**
   * Get current stream state
   */
  getState(): LogStreamState {
    return { ...this.state, bufferSize: this.buffer.length };
  }

  /**
   * Handle new log entry
   */
  private handleNewEntry(entry: IStructuredLogEntry): void {
    if (!this.state.isActive) return;

    this.buffer.push(entry);
    this.state.lastUpdate = new Date();

    // Maintain buffer size
    if (this.buffer.length > this.config.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.config.maxBufferSize);
    }

    this.state.bufferSize = this.buffer.length;
  }

  /**
   * Flush buffer to subscribers
   */
  private flushBuffer(): void {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    // Notify all subscribers
    for (const subscriber of this.subscribers) {
      try {
        subscriber(entries);
      } catch (error) {
        console.error("[LogStreamManager] Subscriber error:", error);
      }
    }

    this.state.bufferSize = 0;
  }

  /**
   * Clean up old entries from buffer
   */
  private cleanupOldEntries(): void {
    const now = Date.now();
    const cutoff = now - this.config.maxEntryAge;

    this.buffer = this.buffer.filter((entry) => {
      const entryTime = new Date(entry.timestamp).getTime();
      return entryTime > cutoff;
    });

    this.state.bufferSize = this.buffer.length;
  }
}

/**
 * Create a log stream manager with default configuration
 */
export function createLogStreamManager(service: StructuredLoggerService): LogStreamManager {
  const defaultConfig: ILogStreamConfig = {
    maxBufferSize: 1000,
    updateInterval: 1000, // 1 second
    enabled: true,
    cleanupInterval: DEFAULT_AI_TIMEOUT_MS, // 30 seconds
    maxEntryAge: 300000, // 5 minutes
  };

  return new LogStreamManager(service, defaultConfig);
}

/**
 * WebSocket-based log streaming (for future use)
 */
export class WebSocketLogStream {
  private ws?: WebSocket;
  private reconnectTimer?: number;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(
    private url: string,
    private onMessage: (data: JSONObject) => void,
    private onError: (error: Error) => void,
    private onConnect: () => void,
    private onDisconnect: () => void,
  ) {}

  connect(): void {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.onConnect();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.onMessage(data);
        } catch (error) {
          this.onError(new Error(`Failed to parse WebSocket message: ${error}`));
        }
      };

      this.ws.onclose = () => {
        this.onDisconnect();
        this.scheduleReconnect();
      };

      this.ws.onerror = (_error) => {
        this.onError(new Error("WebSocket error"));
      };
    } catch (error) {
      this.onError(error as Error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onError(new Error("Max reconnection attempts reached"));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}

/**
 * HTTP polling-based log streaming fallback
 */
export class PollingLogStream {
  private timer?: number;
  private lastTimestamp?: string;

  constructor(
    private endpoint: string,
    private interval: number,
    private onEntries: (entries: IStructuredLogEntry[]) => void,
    private onError: (error: Error) => void,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.poll();
    }, this.interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    try {
      const url = this.lastTimestamp
        ? `${this.endpoint}?since=${encodeURIComponent(this.lastTimestamp)}`
        : this.endpoint;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const entries: IStructuredLogEntry[] = await response.json();

      if (entries.length > 0) {
        this.onEntries(entries);
        // Update last timestamp to the most recent entry
        this.lastTimestamp = entries[entries.length - 1].timestamp;
      }
    } catch (error) {
      this.onError(error as Error);
    }
  }
}
