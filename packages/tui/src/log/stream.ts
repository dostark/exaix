/**
 * @module LogStream
 * @path packages/tui/src/log/stream.ts
 * @related-files []
 * @architectural-layer TUI
 * @ungrounded
 * @description Package-owned TUI log streaming helpers for buffering, delivery, websocket fallback, and polling.
 */

import { DEFAULT_AI_TIMEOUT_MS } from "@exaix/ai/constants.ts";
import { ConnectionStatus } from "@exaix/core";
import type { IStructuredLogEntry, JSONObject } from "@exaix/core/types";

export interface ILogStreamConfig {
  maxBufferSize: number;
  updateInterval: number;
  enabled: boolean;
  cleanupInterval: number;
  maxEntryAge: number;
}

export interface ILogStreamState {
  isActive: boolean;
  bufferSize: number;
  subscriberCount: number;
  lastUpdate: Date | null;
  status: ConnectionStatus;
}

export interface ILogStreamSource {
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

export class WebSocketLogStream {
  private ws?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
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
      this.ws.onerror = () => {
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
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

export class PollingLogStream {
  private timer?: ReturnType<typeof setInterval>;
  private lastTimestamp?: string;

  constructor(
    private endpoint: string,
    private interval: number,
    private onEntries: (entries: IStructuredLogEntry[]) => void,
    private onError: (error: Error) => void,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.poll(), this.interval);
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
        this.lastTimestamp = entries[entries.length - 1].timestamp;
      }
    } catch (error) {
      this.onError(error as Error);
    }
  }
}
