import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  traceId: string;
  errors?: Record<string, string[]>;
}

export function attachTraceId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-trace-id');
  const traceId = incoming && incoming.length <= 64 ? incoming : crypto.randomUUID();
  (req as Request & { traceId: string }).traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
}

export function getTraceId(req: Request): string {
  return (req as Request & { traceId?: string }).traceId || crypto.randomUUID();
}

export function sendProblem(
  req: Request,
  res: Response,
  status: number,
  title: string,
  detail: string,
  errors?: Record<string, string[]>
) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const body: ProblemDetails = {
    type: `https://flagship.dev/problems/${slug}`,
    title,
    status,
    detail,
    instance: req.originalUrl,
    traceId: getTraceId(req),
    ...(errors ? { errors } : {}),
  };
  res.status(status).contentType('application/problem+json').json(body);
}

export function structuredLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, meta: Record<string, unknown> = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: 'flagship-server',
    event,
    ...meta,
  };
  if (level === 'ERROR') {
    console.error(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}
