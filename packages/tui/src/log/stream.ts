/**
 * @module LogStream
 * @path packages/tui/src/log/stream.ts
 * @related-files []
 * @architectural-layer TUI
 * @ungrounded
 * @description Package-owned TUI log streaming helpers for buffering, delivery, websocket fallback, and polling.
 */

import { DEFAULT_AI_TIMEOUT_MS } from "@exaix/ai";
import { ConnectionStatus } from "@exaix/core";
import type { IStructuredLogEntry } from "@exaix/core/types";

interface ILogStreamConfig {
  maxBufferSize: number;
  updateInterval: number;
  enabled: boolean;
  cleanupInterval: number;
  maxEntryAge: number;
}

interface ILogStreamState {
  isActive: boolean;
  bufferSize: number;
  subscriberCount: number;
  lastUpdate: Date | null;
  status: ConnectionStatus;
}

interface ILogStreamSource {
  subscribeToLogs(callback: (entry: IStructuredLogEntry) => void): () => void;
}

export class LogStreamManager {
  private buffer: IStructuredLogEntry[] = [];
  private subscribers: Array<(entries: IStructuredLogEntry[]) => void> = [];
  private updateTimer?: ReturnType<typeof setInterval>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private unsubscribeSource?: () => void;
  private state: ILogStreamState;

  constructor(private service: ILogStreamSource, private config: ILogStreamConfig) {
    this.state = {
      isActive: false,
      bufferSize: 0,
      subscriberCount: 0,
      lastUpdate: null,
      status: ConnectionStatus.DISCONNECTED,
    };
  }

  start(): void {
    if (this.state.isActive) return;

    this.state.isActive = true;
    this.state.status = ConnectionStatus.CONNECTING;
    this.unsubscribeSource = this.service.subscribeToLogs((entry) => this.handleNewEntry(entry));
    this.updateTimer = setInterval(() => this.flushBuffer(), this.config.updateInterval);
    this.cleanupTimer = setInterval(() => this.cleanupOldEntries(), this.config.cleanupInterval);
    this.state.status = ConnectionStatus.CONNECTED;
  }

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
    this.unsubscribeSource?.();
    this.unsubscribeSource = undefined;
    this.subscribers = [];
  }

  subscribe(callback: (entries: IStructuredLogEntry[]) => void): () => void {
    this.subscribers.push(callback);
    this.state.subscriberCount = this.subscribers.length;
    return () => {
      const index = this.subscribers.indexOf(callback);
      if (index > -1) {
        this.subscribers.splice(index, 1);
        this.state.subscriberCount = this.subscribers.length;
      }
    };
  }

  getState(): ILogStreamState {
    return { ...this.state, bufferSize: this.buffer.length };
  }

  private handleNewEntry(entry: IStructuredLogEntry): void {
    if (!this.state.isActive) return;
    this.buffer.push(entry);
    this.state.lastUpdate = new Date();
    if (this.buffer.length > this.config.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.config.maxBufferSize);
    }
    this.state.bufferSize = this.buffer.length;
  }

  private flushBuffer(): void {
    if (this.buffer.length === 0) return;
    const entries = [...this.buffer];
    this.buffer = [];
    for (const subscriber of this.subscribers) {
      try {
        subscriber(entries);
      } catch (error) {
        console.error("[LogStreamManager] Subscriber error:", error);
      }
    }
    this.state.bufferSize = 0;
  }

  private cleanupOldEntries(): void {
    const cutoff = Date.now() - this.config.maxEntryAge;
    this.buffer = this.buffer.filter((entry) => new Date(entry.timestamp).getTime() > cutoff);
    this.state.bufferSize = this.buffer.length;
  }
}

export function createLogStreamManager(service: ILogStreamSource): LogStreamManager {
  return new LogStreamManager(service, {
    maxBufferSize: 1000,
    updateInterval: 1000,
    enabled: true,
    cleanupInterval: DEFAULT_AI_TIMEOUT_MS,
    maxEntryAge: 300000,
  });
}
