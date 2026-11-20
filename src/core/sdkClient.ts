import { evaluateFlag } from './evaluator.ts';
import type { EvaluationContext, EvaluationResult, FlagEnvironmentSnapshot, SegmentDef } from './types.ts';

export interface OfflineSnapshotPayload {
  projectKey: string;
  environmentKey: string;
  generatedAt: string;
  flags: Record<string, FlagEnvironmentSnapshot>;
  segments: Record<string, SegmentDef>;
}

export type ConnectionMode = 'SSE_CONNECTED' | 'POLLING_FALLBACK' | 'OFFLINE_SNAPSHOT' | 'CONNECTING';

export interface FlagShipClientOptions {
  baseUrl: string;
  sdkKey: string;
  storageKey?: string;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  onStatusChange?: (mode: ConnectionMode) => void;
  onSnapshotUpdate?: (snapshot: OfflineSnapshotPayload) => void;
}

/**
 * FlagShip Client SDK (TypeScript)
 * Mirrors the FlagShip Java Spring Boot Starter guarantees:
 * - Local in-memory evaluation (zero network hops per evaluation)
 * - Persistent localStorage offline snapshot
 * - Non-blocking initialization capped at <= 2000ms
 * - SSE streaming with automatic polling fallback and reconnection
 * - Never throws server outages to application business code
 */
export class FlagShipClient {
  private readonly baseUrl: string;
  private readonly sdkKey: string;
  private readonly storageKey: string;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly onStatusChange?: (mode: ConnectionMode) => void;
  private readonly onSnapshotUpdate?: (snapshot: OfflineSnapshotPayload) => void;

  private snapshot: OfflineSnapshotPayload | null = null;
  private eventSource: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private mode: ConnectionMode = 'CONNECTING';
  private simulatedOffline = false;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(options: FlagShipClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.sdkKey = options.sdkKey;
    this.storageKey = options.storageKey || `flagship_snapshot_${options.sdkKey.slice(0, 12)}`;
    this.startupTimeoutMs = Math.min(2000, options.startupTimeoutMs ?? 1800);
    this.pollIntervalMs = options.pollIntervalMs ?? 15000;
    this.onStatusChange = options.onStatusChange;
    this.onSnapshotUpdate = options.onSnapshotUpdate;
    this.loadLocalSnapshot();
  }

  private setMode(next: ConnectionMode) {
    this.mode = next;
    this.onStatusChange?.(next);
  }

  public getMode(): ConnectionMode {
    return this.mode;
  }

  public getMetrics() {
    return {
      mode: this.mode,
      cachedFlags: this.snapshot ? Object.keys(this.snapshot.flags).length : 0,
      lastSync: this.snapshot?.generatedAt ?? null,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  public getSnapshot(): OfflineSnapshotPayload | null {
    return this.snapshot;
  }

  private loadLocalSnapshot() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        this.snapshot = JSON.parse(raw) as OfflineSnapshotPayload;
      }
    } catch {
      // Ignore storage errors; never crash business code
    }
  }

  private persistLocalSnapshot(payload: OfflineSnapshotPayload) {
    this.snapshot = payload;
    this.onSnapshotUpdate?.(payload);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(payload));
      }
    } catch {
      // Non-fatal
    }
  }

  public async initialize(): Promise<void> {
    if (this.simulatedOffline) {
      this.setMode('OFFLINE_SNAPSHOT');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.startupTimeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/sdk/snapshot?sdkKey=${encodeURIComponent(this.sdkKey)}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as OfflineSnapshotPayload;
        this.persistLocalSnapshot(data);
        this.connectSse();
      } else {
        this.setMode(this.snapshot ? 'OFFLINE_SNAPSHOT' : 'POLLING_FALLBACK');
        this.startPollingFallback();
      }
    } catch {
      // Offline resilience: never block > 2s and never throw to caller
      this.setMode('OFFLINE_SNAPSHOT');
      this.startPollingFallback();
    } finally {
      clearTimeout(timer);
    }
  }

  private connectSse() {
    if (this.simulatedOffline || typeof EventSource === 'undefined') {
      this.setMode('OFFLINE_SNAPSHOT');
      return;
    }
    this.closeSse();
    try {
      const es = new EventSource(`${this.baseUrl}/api/sdk/stream?sdkKey=${encodeURIComponent(this.sdkKey)}`);
      this.eventSource = es;

      es.addEventListener('open', () => {
        if (!this.simulatedOffline) {
          this.stopPollingFallback();
          this.setMode('SSE_CONNECTED');
        }
      });

      es.addEventListener('snapshot', (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as OfflineSnapshotPayload;
          this.persistLocalSnapshot(payload);
        } catch {
          // Ignore malformed frame
        }
      });

      es.addEventListener('flag:updated', () => {
        void this.refreshSnapshot();
      });

      es.addEventListener('flag:killswitch', () => {
        void this.refreshSnapshot();
      });

      es.onerror = () => {
        if (this.simulatedOffline) {
          this.setMode('OFFLINE_SNAPSHOT');
          return;
        }
        this.setMode('POLLING_FALLBACK');
        this.startPollingFallback();
      };
    } catch {
      this.setMode('POLLING_FALLBACK');
      this.startPollingFallback();
    }
  }

  public async refreshSnapshot(): Promise<boolean> {
    if (this.simulatedOffline) return false;
    try {
      const res = await fetch(`${this.baseUrl}/api/sdk/snapshot?sdkKey=${encodeURIComponent(this.sdkKey)}`);
      if (!res.ok) return false;
      const data = (await res.json()) as OfflineSnapshotPayload;
      this.persistLocalSnapshot(data);
      return true;
    } catch {
      this.setMode('OFFLINE_SNAPSHOT');
      return false;
    }
  }

  public setSimulatedOffline(offline: boolean) {
    this.simulatedOffline = offline;
    if (offline) {
      this.closeSse();
      this.stopPollingFallback();
      this.setMode('OFFLINE_SNAPSHOT');
    } else {
      void this.initialize();
    }
  }

  private startPollingFallback() {
    if (this.pollTimer || this.simulatedOffline) return;
    this.pollTimer = setInterval(async () => {
      const ok = await this.refreshSnapshot();
      if (ok && this.mode !== 'SSE_CONNECTED') {
        this.connectSse();
      }
    }, this.pollIntervalMs);
  }

  private stopPollingFallback() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private closeSse() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  public close() {
    this.closeSse();
    this.stopPollingFallback();
  }

  public evaluate<T>(flagKey: string, context: EvaluationContext, defaultValue: T): EvaluationResult<T> {
    try {
      const snap = this.snapshot?.flags?.[flagKey];
      if (!snap) {
        this.cacheMisses++;
        return {
          flagKey,
          variationKey: 'fallback',
          value: defaultValue,
          reason: 'FALLBACK_ERROR',
          durationMicros: 0.1,
        };
      }
      this.cacheHits++;
      return evaluateFlag<T>(snap, context, this.snapshot?.segments || {});
    } catch {
      return {
        flagKey,
        variationKey: 'fallback',
        value: defaultValue,
        reason: 'FALLBACK_ERROR',
        durationMicros: 0.1,
      };
    }
  }

  public getBoolean(flagKey: string, ctx: EvaluationContext, fallback = false): boolean {
    const val = this.evaluate<unknown>(flagKey, ctx, fallback).value;
    return typeof val === 'boolean' ? val : fallback;
  }

  public getString(flagKey: string, ctx: EvaluationContext, fallback = ''): string {
    const val = this.evaluate<unknown>(flagKey, ctx, fallback).value;
    return typeof val === 'string' ? val : fallback;
  }

  public getNumber(flagKey: string, ctx: EvaluationContext, fallback = 0): number {
    const val = this.evaluate<unknown>(flagKey, ctx, fallback).value;
    return typeof val === 'number' ? val : fallback;
  }

  public getJson<T = Record<string, unknown>>(flagKey: string, ctx: EvaluationContext, fallback: T): T {
    const val = this.evaluate<unknown>(flagKey, ctx, fallback).value;
    return val !== null && typeof val === 'object' ? (val as T) : fallback;
  }
}
