import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { dbEngineMode, ensureDatabaseReady } from './src/db/index.ts';
import { attachTraceId, sendProblem, structuredLog } from './src/server/problem.ts';
import { authUsersRouter } from './src/server/routes-auth-users.ts';
import { projectsFlagsRouter } from './src/server/routes-projects-flags.ts';
import { applyDueScheduledApprovals, governanceAnalyticsRouter } from './src/server/routes-governance-analytics.ts';
import { ensureSeeded } from './src/server/seed.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  // Initialize 100% local PostgreSQL schema and seed baseline demo workspace
  await ensureDatabaseReady();
  await ensureSeeded();

  // Check for due scheduled rollouts every 15 seconds
  const scheduleTimer = setInterval(() => {
    void applyDueScheduledApprovals().catch((err) => {
      console.error('Scheduled rollout processor error:', err);
    });
  }, 15000);
  scheduleTimer.unref();

  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use(attachTraceId);

  // CORS for SDK & external demo clients
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-FlagShip-SDK-Key, X-Trace-Id');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Mount FlagShip REST & SSE APIs
  app.use('/api', authUsersRouter);
  app.use('/api', projectsFlagsRouter);
  app.use('/api', governanceAnalyticsRouter);

  // Unknown API routes -> RFC 9457 404
  app.use('/api', (req, res) => {
    sendProblem(req, res, 404, 'Endpoint Not Found', `No API handler registered for ${req.method} ${req.originalUrl}`);
  });

  // Frontend Vite middleware in dev, or built dist in production
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    structuredLog('INFO', 'server.started', {
      port: PORT,
      mode: isProduction ? 'production' : 'development',
      dbEngine: dbEngineMode,
    });
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
