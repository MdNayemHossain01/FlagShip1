import crypto from 'node:crypto';
import type { Response } from 'express';
import { structuredLog } from './problem.ts';

interface SseClient {
  id: string;
  res: Response;
  projectId?: number;
  environmentId?: number;
  sdkKeyPrefix?: string;
  connectedAt: string;
}

class ObservabilityAndStreamHub {
  private clients = new Map<string, SseClient>();
  private metrics = {
    flagEvaluationsTotal: 0,
    evaluationDurationMicrosSum: 0,
    evaluationDurationMicrosMax: 0,
    cacheHits: 0,
    cacheMisses: 0,
    configUpdatesPublished: 0,
    experimentEventsRecorded: 0,
    startedAt: new Date().toISOString(),
  };

  public registerClient(
    res: Response,
    filter: { projectId?: number; environmentId?: number; sdkKeyPrefix?: string }
  ): string {
    const id = crypto.randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const client: SseClient = {
      id,
      res,
      projectId: filter.projectId,
      environmentId: filter.environmentId,
      sdkKeyPrefix: filter.sdkKeyPrefix,
      connectedAt: new Date().toISOString(),
    };
    this.clients.set(id, client);

    this.sendToClient(client, 'connected', {
      clientId: id,
      connectedAt: client.connectedAt,
      activeConnections: this.clients.size,
    });

    const heartbeat = setInterval(() => {
      if (!this.clients.has(id)) {
        clearInterval(heartbeat);
        return;
      }
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        this.removeClient(id);
        clearInterval(heartbeat);
      }
    }, 20000);

    res.on('close', () => {
      clearInterval(heartbeat);
      this.removeClient(id);
    });

    return id;
  }

  public removeClient(id: string) {
    this.clients.delete(id);
  }

  private sendToClient(client: SseClient, event: string, data: unknown) {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.clients.delete(client.id);
    }
  }

  public broadcast(
    event: string,
    payload: Record<string, unknown>,
    scope?: { projectId?: number; environmentId?: number }
  ) {
    this.metrics.configUpdatesPublished++;
    const enriched = {
      ...payload,
      eventId: crypto.randomUUID(),
      publishedAt: new Date().toISOString(),
    };

    let delivered = 0;
    for (const client of this.clients.values()) {
      const matchProject = !scope?.projectId || !client.projectId || client.projectId === scope.projectId;
      const matchEnv =
        !scope?.environmentId || !client.environmentId || client.environmentId === scope.environmentId;
      if (matchProject && matchEnv) {
        this.sendToClient(client, event, enriched);
        delivered++;
      }
    }

    structuredLog('INFO', 'sse.broadcast', {
      event,
      delivered,
      activeConnections: this.clients.size,
    });
    return delivered;
  }

  public recordEvaluation(durationMicros: number, cacheHit = true) {
    this.metrics.flagEvaluationsTotal++;
    this.metrics.evaluationDurationMicrosSum += durationMicros;
    if (durationMicros > this.metrics.evaluationDurationMicrosMax) {
      this.metrics.evaluationDurationMicrosMax = durationMicros;
    }
    if (cacheHit) this.metrics.cacheHits++;
    else this.metrics.cacheMisses++;
  }

  public recordExperimentEvent(count = 1) {
    this.metrics.experimentEventsRecorded += count;
  }

  public getMetricsSnapshot() {
    const avgMicros =
      this.metrics.flagEvaluationsTotal > 0
        ? Number((this.metrics.evaluationDurationMicrosSum / this.metrics.flagEvaluationsTotal).toFixed(2))
        : 0;
    return {
      status: 'UP',
      startedAt: this.metrics.startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      sseActiveConnections: this.clients.size,
      flagEvaluationsTotal: this.metrics.flagEvaluationsTotal,
      evaluationDurationMicrosAvg: avgMicros,
      evaluationDurationMicrosMax: this.metrics.evaluationDurationMicrosMax,
      cacheHits: this.metrics.cacheHits,
      cacheMisses: this.metrics.cacheMisses,
      configUpdatesPublished: this.metrics.configUpdatesPublished,
      experimentEventsRecorded: this.metrics.experimentEventsRecorded,
      memoryHeapUsedMb: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
    };
  }
}

export const streamHub = new ObservabilityAndStreamHub();
